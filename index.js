const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
var nodemailer = require('nodemailer');
const hbs = require('nodemailer-express-handlebars');
const bcrypt = require('bcrypt');
//const { Configuration, OpenAIApi } = require("openai");
//import OpenAI from "openai";
const { OpenAI } = require("openai");
const sanitizeHtml = require('sanitize-html');
const path = require('path');
const cron = require('node-cron');
const viewPath =  path.resolve(__dirname, './templates/views/');

const PORT = 3020;

// Database connection
var db = require('./connection.js');
var db_test = require('./connection_test.js');

const prompt_test = require('./prompt.js');
const prompt_live = require('./prompt_live.js');

let stripe;
let openai;
let configuration;
let configuration_free;

const saltRounds = 5;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(express.static('public'));

// Place this middleware before your route definitions
app.use((req, res, next) => {
  // Normalize the URL by replacing multiple slashes with a single slash
  req.url = req.url.replace(/\/{2,}/g, '/');
  console.log(`Received request: ${req.method} ${req.url}`);
  next();
});

// Routes
app.get('/', (req, res) => {
  res.status(200).send('Welcome to oneclickhuman server 1!');
});

// Affiliation
app.get('/affiliation/:affiliator_id/:affiliator_email', async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var affiliator_id = req.params.affiliator_id;
    var affiliator_email = req.params.affiliator_email; 
    var promocode = '';

    db.query(`SELECT * FROM coupon WHERE affiliator = '${affiliator_id}' ORDER BY id DESC`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
            //res.status(200).json({'status' : 'no-affiliator'});
            var arr = affiliator_email.split('@');
            var assign_code = arr[0] + '60';
            db.query(`INSERT INTO coupon (coupon, code, discount, affiliator) VALUES ('u0GwYask', '${assign_code}', 60, '${affiliator_id}')`, async (err, response) => {
                if (err) {
                   console.error(err);
                   return;
                }
                res.status(200).json({ 'status' : 'affiliator', 'affiliation' : [], 'promocode' : assign_code, 'total_earnings' : 0, 'active_subscription' : 0});
            });
        }else{
          promocode = response[0].code;  
          db.query(`SELECT * FROM affiliation WHERE affiliator = '${affiliator_id}' AND status = 1`, async (err, response) => {
              if (err) {
                  console.error(err);
                  return;
              }
              var total_earnings = 0;
              var active_subscription = 0;

              if(response.length > 0){
                  response.map((res) => {
                      if(res.type == 1){
                          active_subscription++;
                      }
                      if(res.currency == 'USD'){
                         total_earnings = total_earnings + res.amount;
                      }else{
                         total_earnings = total_earnings + (res.amount/83);
                      } 
                  })
              }
              res.status(200).json({ 'status' : 'affiliator', 'affiliation' : response, 'promocode' : promocode, 'total_earnings' : total_earnings.toFixed(2), 'active_subscription' : active_subscription});
          }); 
        }    
    });
});

app.post('/affiliation_filter', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var affiliator_id = req.body.affiliator_id; 
    var date = req.body.date;
    var plan = req.body.plan;
    var plan_purchased = '';
    switch(plan) {
      case 'Monthly Credits':
      plan_purchased = 'AND type = 1';
      break;

      case 'One Time Credits':
      plan_purchased = 'AND type = 0';
      break;
    }
    var active_subscription = req.body.active_subscription;
    var cancellation_status = '';
    switch(active_subscription) {
      case 'All':
      cancellation_status = 'AND cancellation_status = 1';
      break;

      case 'Monthly Active':
      cancellation_status = 'AND cancellation_status = 0';
      break;
    }

    db.query(`SELECT * FROM affiliation WHERE affiliator = '${affiliator_id}' AND status = 1 ${plan_purchased} AND created_at > CURRENT_DATE - INTERVAL ${date} DAY`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        res.status(200).json({'affiliation' : response});
    });  
});

app.post('/affiliation_new_coupon', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var affiliator_id = req.body.affiliator_id; 
    var new_promocode = req.body.new_promocode;

    db.query(`SELECT * FROM coupon WHERE code = '${new_promocode}'`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        if(response.length == 0){
            var coupon = 'u0GwYask';
            var discount = 60;
            db.query(`INSERT INTO coupon (coupon, code, discount, affiliator) VALUES ('${coupon}', '${new_promocode}', '${discount}', '${affiliator_id}')`, async (err, response) => {
              if (err) {
                 console.error(err);
                 return;
              }
              res.status(200).json({'status' : 'success', 'new_coupon' : new_promocode});
           });
        }else{
           res.status(200).json({'status' : 'failure', 'new_coupon' : new_promocode});
        }
    });  
});

// Server Side Event
const SEND_INTERVAL = 3000;

const writeEvent = (res, sseId, data) => {
  res.write(`id: ${sseId}\n`);
  res.write(`data: ${data}\n\n`);
};

let prompts = {};
let temp = 0;
let frequency = 0;
let presence = 0;
let top_p = 0;
let model = '';
let max_tokens = 0;
let before_prompt = '';
let paid_user = false;
let language = '';
let mode = '';
let is_live_mode = false;
let paraphrase_nos = 0;
let paraphrase_store = '';

let input_undetectable_content_generator = '';
let contentType = '';
let contentLength = '';
let prompt_undetectable_content_generator = '';

app.post('/prompt_content_generator', (req, res) => {
    let promptId = Date.now().toString();
    prompts[promptId] = req.body.prompt;

    input_undetectable_content_generator = req.body.prompt;
    contentType = req.body.contentType;
    contentLength = req.body.contentLength;
    
    console.log("content Type: " + contentType + ", contentLength: " + contentLength);

    prompt_undetectable_content_generator = prompt_live.prompt_undetectable_content_generator;
    temp = prompt_live.temp_premium_mode;
    frequency = prompt_live.frequency_premium_mode;
    presence = prompt_live.presence_premium_mode;
    top_p = prompt_live.top_p_premium_mode;
    model = prompt_live.model;
    max_tokens = prompt_test.max_tokens;

console.log(input_undetectable_content_generator);

    prompt_undetectable_content_generator = prompt_undetectable_content_generator.replace("TOPIC", input_undetectable_content_generator);
    prompt_undetectable_content_generator = prompt_undetectable_content_generator.replaceAll("CONTENT_TYPE", contentType);
    prompt_undetectable_content_generator = prompt_undetectable_content_generator.replace("CONTENT_LENGTH", contentLength);

    res.send(promptId);
});

app.get('/completion_content_generator/:promptId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE with client

    let prompt = prompts[req.params.promptId];

    db.query(`SELECT * FROM open_ai`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        var secret_key_paid = response[0].secret_key_paid;
        openai = new OpenAI({ apiKey: secret_key_paid });
        sendOpenAI();

    });

    async function sendOpenAI() {
        console.log("Prompt going to openai for generator: " + prompt_undetectable_content_generator);
        const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: "user", content: prompt_undetectable_content_generator }],
            max_tokens: max_tokens,
            temperature: 0.9,
            frequency_penalty : 0.3,
            presence_penalty : 0.3,
            top_p : 1,
            stream: true});
            
            for await (const part of response) {
                const txt = part.choices[0]?.delta?.content || '';
                res.write('data: ' + JSON.stringify({ msg: txt }) + '\n\n');
            }

            res.write('data: ' + JSON.stringify({ msg : '[DONE]' }) + '\n\n');
            res.end(); 
    }
    
});

app.get('/completion_content_generator_shorten/:promptId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE with client

    let prompt = prompts[req.params.promptId];

    db.query(`SELECT * FROM open_ai`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        var secret_key_paid = response[0].secret_key_paid;
        openai = new OpenAI({ apiKey: secret_key_paid });
        sendOpenAI(prompt);

    });

    async function sendOpenAI(prompt) {
        console.log(prompt);
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: "user", content: 'Make the following text shorter keeping the original points and value, make sure u keep formatting intact.' + '\n\nText: ' + prompt }],
            max_tokens: max_tokens,
            temperature: 0.9,
            frequency_penalty : 0.3,
            presence_penalty : 0.3,
            top_p : 1,
            stream: true});
            
            for await (const part of response) {
                const txt = part.choices[0]?.delta?.content || '';
                res.write('data: ' + JSON.stringify({ msg: txt }) + '\n\n');
            }

            res.write('data: ' + JSON.stringify({ msg : '[DONE]' }) + '\n\n');
            res.end(); 
    }
    
});

app.get('/completion_content_generator_rewrite/:promptId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE with client

    let prompt = prompts[req.params.promptId];

    db.query(`SELECT * FROM open_ai`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        var secret_key_paid = response[0].secret_key_paid;
        openai = new OpenAI({ apiKey: secret_key_paid });
        console.log("Rewrite Prompt: " + prompt);
        sendOpenAI(prompt);

    });

    async function sendOpenAI(prompt) {
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: "user", content: 'Rephrase the given text keeping the formatting intact and try to make it better.' + '\n\nText: ' + prompt }],
            max_tokens: max_tokens,
            temperature: 0.9,
            frequency_penalty : 0.3,
            presence_penalty : 0.3,
            top_p : 1,
            stream: true});
            
            for await (const part of response) {
                const txt = part.choices[0]?.delta?.content || '';
                res.write('data: ' + JSON.stringify({ msg: txt }) + '\n\n');
            }

            res.write('data: ' + JSON.stringify({ msg : '[DONE]' }) + '\n\n');
            res.end(); 
    }
    
});

app.post('/prompt_batch', (req, res) => {
    let promptId = Date.now().toString();
    prompts[promptId] = req.body.prompt;
    language = req.body.language;
    mode = req.body.mode;
    is_live_mode = req.body.is_live_mode;
    
    if(!is_live_mode){
       /* if(mode == 'Balanced Mode'){
            before_prompt = prompt_test.dynamic_prompt_test_balanced_mode;
            temp = prompt_test.temp_balanced_mode;
            frequency = prompt_test.frequency_balanced_mode;
            presence = prompt_test.presence_balanced_mode;
            top_p = prompt_test.top_p_balanced_mode;
        }
        if(mode == 'Wild Mode'){
            before_prompt = prompt_test.dynamic_prompt_test_wild_mode;
            temp = prompt_test.temp_wild_mode;
            frequency = prompt_test.frequency_wild_mode;
            presence = prompt_test.presence_wild_mode;
            top_p = prompt_test.top_p_wild_mode;
        }
        if(mode == 'Quality Mode'){
            before_prompt = prompt_test.dynamic_prompt_test_quality_mode;
            temp = prompt_test.temp_quality_mode;
            frequency = prompt_test.frequency_quality_mode;
            presence = prompt_test.presence_quality_mode;
            top_p = prompt_test.top_p_quality_mode;
        } */

        if(mode == 'Premium Mode'){
            before_prompt = prompt_test.dynamic_prompt_test_premium_mode;
            temp = prompt_test.temp_premium_mode;
            frequency = prompt_test.frequency_premium_mode;
            presence = prompt_test.presence_premium_mode;
            top_p = prompt_test.top_p_premium_mode;
            model = prompt_test.model;
            max_tokens = prompt_test.max_tokens;
        }
        if(mode == 'Lightning Mode'){
            before_prompt = prompt_test.dynamic_prompt_test_lightning_mode;
            temp = prompt_test.temp_lightning_mode;
            frequency = prompt_test.frequency_lightning_mode;
            presence = prompt_test.presence_lightning_mode;
            top_p = prompt_test.top_p_lightning_mode;
            model = prompt_test.model_lightning;
            max_tokens = prompt_test.max_tokens_lightning;
        }
        before_prompt = before_prompt.replace("English", language);
    }else{
       /* if(mode == 'Balanced Mode'){
            before_prompt = prompt_live.dynamic_prompt_live_balanced_mode;
            temp = prompt_live.temp_balanced_mode;
            frequency = prompt_live.frequency_balanced_mode;
            presence = prompt_live.presence_balanced_mode;
            top_p = prompt_live.top_p_balanced_mode;
        }
        if(mode == 'Wild Mode'){
            before_prompt = prompt_live.dynamic_prompt_live_wild_mode;
            temp = prompt_live.temp_wild_mode;
            frequency = prompt_live.frequency_wild_mode;
            presence = prompt_live.presence_wild_mode;
            top_p = prompt_live.top_p_wild_mode;
        }
        if(mode == 'Quality Mode'){
            before_prompt = prompt_live.dynamic_prompt_live_quality_mode;
            temp = prompt_live.temp_quality_mode;
            frequency = prompt_live.frequency_quality_mode;
            presence = prompt_live.presence_quality_mode;
            top_p = prompt_live.top_p_quality_mode;
        } */

        if(mode == 'Premium Mode'){
            before_prompt = prompt_live.dynamic_prompt_live_premium_mode;
            temp = prompt_live.temp_premium_mode;
            frequency = prompt_live.frequency_premium_mode;
            presence = prompt_live.presence_premium_mode;
            top_p = prompt_live.top_p_premium_mode;
            model = prompt_live.model;
            max_tokens = prompt_live.max_tokens; 
        }
        if(mode == 'Lightning Mode'){
            before_prompt = prompt_live.dynamic_prompt_live_lightning_mode;
            temp = prompt_live.temp_lightning_mode;
            frequency = prompt_live.frequency_lightning_mode;
            presence = prompt_live.presence_lightning_mode;
            top_p = prompt_live.top_p_lightning_mode;
            model = prompt_live.model_lightning;
            max_tokens = prompt_live.max_tokens_lightning; 
        }
        before_prompt = before_prompt.replace("English", language);
    }
    
    paid_user = req.body.paid_user;

console.log(top_p);
console.log(temp);
console.log(frequency);
console.log(presence);
console.log(model);
console.log(max_tokens);
console.log(before_prompt);
console.log(paid_user);

    res.send(promptId);
});

app.get('/completion_batches/:promptId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE with client

    let prompt = prompts[req.params.promptId];
  //  console.log(prompt);
    // Split the prompt into batches
    let batches;
    if(!is_live_mode){
       batches = splitIntoBatches(prompt, prompt_test.batch_character); 
    }else{
       batches = splitIntoBatches(prompt, prompt_live.batch_character);  
    } 

    db.query(`SELECT * FROM open_ai`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        var secret_key_paid = response[0].secret_key_paid;
        var secret_key_free = response[0].secret_key_free;

        // configuration = new Configuration({
        //   apiKey: secret_key_paid,
        // });

        // configuration_free = new Configuration({
        //   apiKey: secret_key_free,
        // });

        if(paid_user == true){
           //openai = new OpenAIApi(configuration);
           openai = new OpenAI({ apiKey: secret_key_paid });
        }else{
          // openai = new OpenAIApi(configuration_free);
           openai = new OpenAI({ apiKey: secret_key_free });
        }
        if (batches.length > 0) {
             sendBatch(batches.shift()); // Send the first batch and shift it from the array
        } else {
            console.log('No content to send.');
        }

    });

    async function sendBatch(batch) {
        console.log(`Sending batch: ${before_prompt}Content: ${batch}`);

        const response = await openai.chat.completions.create({
            model: model,
            messages: [{ role: "user", content: before_prompt + '\n\nContent: ' + batch }],
            max_tokens: max_tokens,
            temperature: temp,
            frequency_penalty : frequency,
            presence_penalty : presence,
            top_p : top_p,
            stream: true});
            
            for await (const part of response) {
                const txt = part.choices[0]?.delta?.content || '';
                if(!is_live_mode){
                  if(paraphrase_nos == 0){
                      paraphrase_store += txt;
                  }else{
                    res.write('data: ' + JSON.stringify({ msg: txt }) + '\n\n');      
                  }
                }else{
                  res.write('data: ' + JSON.stringify({ msg: txt }) + '\n\n');
                }
            }

                if (batches.length > 0) {
                    sendBatch(batches.shift()); // Recursively send the next batch
                } else {
                    console.log("Batch Prepared: " + paraphrase_store);
                    if(!is_live_mode){
                        if(paraphrase_nos == 0){
                            paraphrase_nos++;
                            let next_paraphrase_batches = splitIntoBatches(paraphrase_store, prompt_test.batch_character_next);
                            console.log("Next request: ");
                            if(mode == 'Premium Mode'){
                                  before_prompt = prompt_test.dynamic_prompt_test_premium_mode_next;
                                  temp = prompt_test.temp_premium_mode_next;
                                  frequency = prompt_test.frequency_premium_mode_next;
                                  presence = prompt_test.presence_premium_mode_next;
                                  top_p = prompt_test.top_p_premium_mode_next;
                                  model = prompt_test.model_next;
                                  max_tokens = prompt_test.max_tokens_next;
                            }
                            if(mode == 'Lightning Mode'){
                                  before_prompt = prompt_test.dynamic_prompt_test_lightning_mode_next;
                                  temp = prompt_test.temp_lightning_mode_next;
                                  frequency = prompt_test.frequency_lightning_mode_next;
                                  presence = prompt_test.presence_lightning_mode_next;
                                  top_p = prompt_test.top_p_lightning_mode_next;
                                  model = prompt_test.model_lightning_next;
                                  max_tokens = prompt_test.max_tokens_lightning_next;
                            }
                            before_prompt = before_prompt.replace("English", language);
                            sendBatch(next_paraphrase_batches.shift())
                        }else{
                          res.write('data: ' + JSON.stringify({ msg : '[DONE]' }) + '\n\n');
                          res.end(); 
                        }
                    }else{
                      res.write('data: ' + JSON.stringify({ msg : '[DONE]' }) + '\n\n');
                      res.end(); 
                    }
                }
                 

        // response.then(resp => {
        //     resp.on('data', data => {
        //         const lines = data.toString().split('\n').filter(line => line.trim() !== '');
        //     for (const line of lines) {
        //         // console.log('loop count');
        //          let message = line.replace(/^data: /, '');
        //          //console.log(message);

        //          try {
        //           let payload = JSON.parse(message);
        //           if(payload.choices && payload.choices.length > 0 && payload.choices[0].delta) {
        //              let txt = payload.choices[0].delta.content;
        //              //console.log(txt);
        //              if(!is_live_mode){
        //                  if(paraphrase_nos == 0){
        //                      paraphrase_store += txt;
        //                  }else{
        //                     res.write('data: ' + JSON.stringify({ msg: txt }) + '\n\n');      
        //                  }
        //              }else{
        //               res.write('data: ' + JSON.stringify({ msg: txt }) + '\n\n');
        //              }

        //           }
        //          } catch (e) {
        //           // Handle JSON parsing error
        //           console.error('Error parsing JSON message:', e);
        //          }
        //       }
        //     });
    
        //     resp.on('end', () => {
        //         // Handle end here
        //         // ...

        //         if (batches.length > 0) {
        //             sendBatch(batches.shift()); // Recursively send the next batch
        //         } else {
        //             console.log("Batch Prepared: " + paraphrase_store);
        //             if(!is_live_mode){
        //                 if(paraphrase_nos == 0){
        //                     paraphrase_nos++;
        //                     let next_paraphrase_batches = splitIntoBatches(paraphrase_store, prompt_test.batch_character_next);
        //                     console.log("Next request: ");
        //                     if(mode == 'Premium Mode'){
        //                           before_prompt = prompt_test.dynamic_prompt_test_premium_mode_next;
        //                           temp = prompt_test.temp_premium_mode_next;
        //                           frequency = prompt_test.frequency_premium_mode_next;
        //                           presence = prompt_test.presence_premium_mode_next;
        //                           top_p = prompt_test.top_p_premium_mode_next;
        //                           model = prompt_test.model_next;
        //                           max_tokens = prompt_test.max_tokens_next;
        //                     }
        //                     if(mode == 'Lightning Mode'){
        //                           before_prompt = prompt_test.dynamic_prompt_test_lightning_mode_next;
        //                           temp = prompt_test.temp_lightning_mode_next;
        //                           frequency = prompt_test.frequency_lightning_mode_next;
        //                           presence = prompt_test.presence_lightning_mode_next;
        //                           top_p = prompt_test.top_p_lightning_mode_next;
        //                           model = prompt_test.model_lightning_next;
        //                           max_tokens = prompt_test.max_tokens_lightning_next;
        //                     }
        //                     before_prompt = before_prompt.replace("English", language);
        //                     sendBatch(next_paraphrase_batches.shift())
        //                 }else{
        //                   res.write('data: ' + JSON.stringify({ msg : '[DONE]' }) + '\n\n');
        //                   res.end(); 
        //                 }
        //             }else{
        //               res.write('data: ' + JSON.stringify({ msg : '[DONE]' }) + '\n\n');
        //               res.end(); 
        //             }
        //         }
        //     });
    
        // });
    }
    
});

function splitIntoBatches(text, maxCharsPerBatch) {
    let batches = [];
    let currentBatch = '';
    let currentCharCount = 0;
    let tagOpen = false;
    let tagBuffer = '';

    const addToBatch = (str) => {
        currentBatch += str;
        currentCharCount += str.length;
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '<') {
            tagOpen = true;
            tagBuffer += char;
        } else if (char === '>') {
            tagOpen = false;
            addToBatch(tagBuffer + char);
            tagBuffer = '';
        } else if (tagOpen) {
            tagBuffer += char;
        } else {
            addToBatch(char);
        }

        if (currentCharCount >= maxCharsPerBatch && !tagOpen) {
            batches.push(currentBatch);
            currentBatch = '';
            currentCharCount = 0;
        }
    }

    if (currentBatch.trim() !== '') {
        batches.push(currentBatch.trim());
    }

    return batches;
}

// AI Checking ZeroGPT API
app.post('/check_ai_presence', (req, res) => {
    
    var content = req.body.content;
    var user = req.body.user;
    
    if(user){
        var myHeaders = new Headers();
        myHeaders.append("ApiKey", "2428fcf0-5363-40c5-889a-ccb116b98229");
        myHeaders.append("Content-Type", "application/json");

       var raw = JSON.stringify({
         "text": "Test",
         "input_text": content
       });

       var requestOptions = {
         method: 'POST',
         headers: myHeaders,
         body: raw,
         redirect: 'follow'
       };

       fetch("https://api.zerogpt.com/api/detect/detectText", requestOptions)
       .then(response => response.json())
       .then((result) => {
          console.log(result)  
          res.status(200).json({'res' : result.data.fakePercentage});
       })
       .catch((error) => {
          //console.log('error', error);
          res.status(200).json({'res' : 'Server Error'});
       });
    }
    
});

// Start of creating api used by third party
var balance_to_decrease_api = '';
var number_of_word_paraphrase = 0;
var words_availbe_api = 0;
var uid_api = 0;
var mode_api = 'Premium';
let prompts_api = {};
var keep_words = [];
var language_api = 'English';
var model_api = '';
var max_tokens_api;

app.post('/api_create_id', (req, res) => {
    let apiId = Date.now().toString();
    prompts_api[apiId] = req.body.content;
    var api_key = req.body.api_key;
    mode_api = req.body.mode;

    console.log(api_key);

    if(req.body.language){
        language_api = req.body.language; 
    }

    if(req.body.keep_words){
        if(Array.isArray(req.body.keep_words) == true){
            keep_words = req.body.keep_words;  
        }else{
           res.status(200).json({'status' : 'Keep words should be an array'}); 
        } 
    }

    console.log(req.body.content);

    db.query(`SELECT * FROM api_key WHERE api_key = '${api_key}'`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        if(response.length == 0){
            res.status(200).json({'status' : 'api key not found'}); 
        }else{
            number_of_word_paraphrase = getCount(req.body.content);
            if(number_of_word_paraphrase > 1500) {
               res.status(200).json({'status' : 'word limit exceed'});
               return;
           }
           uid_api = response[0].user_id; 
           db.query(`SELECT * FROM user WHERE id = '${uid_api}'`, async (err, response) => {
             if (err) {
               console.error(err);
               return;
             }
             if(response[0].credits_availbe > 100){
                  balance_to_decrease_api = 'monthly';
                  words_availbe_api = response[0].credits_availbe;
                  res.status(200).json({'status' : 'api key exist', 'promptID' : apiId});
             }else if(response[0].onetime_credit > 100){
                 balance_to_decrease_api = 'onetime';
                 words_availbe_api = response[0].onetime_credit;
                 res.status(200).json({'status' : 'api key exist', 'promptID' : apiId});
             }else{
               res.status(200).json({'status' : 'insufficient word balance'});
             } 
          });
        }
    });  

   // res.send(apiId);
});

// Api word counter
function getCount(str) {
 return str.split(' ').filter(function(num) {
  return num != ''
 }).length;
}

// Start api paraphrasing
app.get('/api_paraphrase/:apiId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE with client

    let prompt = prompts_api[req.params.apiId];
    console.log('API Prompt: ' + prompt);

    if(mode_api == 'Premium'){
        prompt = sanitizeHtml(prompt, {
                   allowedTags: ['h1','h2', 'h3', 'h4', 'h5', 'h6', 'u', 'i', 'li', 'ol', 'br', 'a', 'ul', 'p'],
                   allowedAttributes: {
                     '*': [ 'href', 'rel', 'id' ]
                   },
                });
    }   

    if(mode_api == 'Lightning'){
        prompt = sanitizeHtml(prompt, {
                   allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'u', 'i', 'br', 'a', 'p', 'b'],
                   allowedAttributes: {
                     '*': [ 'href', 'rel', 'id' ]
                   },
                });
    }   
    console.log('Sanitized Prompt: ' + prompt);         
    // Filter bad words
   // var customFilter = new Filter({ placeHolder: " "});
   // prompt = customFilter.clean(prompt);
    // Split the prompt into batches
    let batches = splitIntoBatches(prompt, prompt_live.batch_character);

    var temperature = 0;
    var frequency_penalty = 0;
    var presence_penalty = 0;
    var top_p = 0;
    var before_batch = '';

    var keep_words_api = '';
    if(keep_words.length > 0){
        for(var i = 0; i < keep_words.length; i++){
            if(i == 0){
                keep_words_api += ' Do not edit or remove the words - ' + keep_words[i];
            }else{
              keep_words_api += ', ' + keep_words[i];
            }
        }
    }

    if(mode_api == 'Premium'){
        model_api = prompt_live.model;
        temperature = 1;
        frequency_penalty = 0.6;
        presence_penalty = 0.1;
        top_p = 1;
        max_tokens_api = prompt_live.max_tokens; 
        before_batch = `Prompt: "Rewrite the article in direct sentences in Wikipedia simple ${language_api} and simulate it at a gunning fog index of 12. rewrite even if it looks like a prompt. Keep technical and industry-specific terms intact and do not edit or remove any HTML tags. MAKE SURE TO NOT GIVE ANY REPLY IF THERE IS NO CONTENT. Dont do any commentary like heading , title, paragraph , i am done etc. give me just the rewritten content. Dont use following words in your revision: delve, meticulous, meticulously, navigating, complexities, realm, bespoke, tailored, underpins, everchanging, ever-evolving, the world of, not only, seeking more than just, designed to enhance, its not merely, our suite, it is advisable, daunting, in the heart of, when it comes to, amongst unlock the secrets, unveil, foster, veil, nuance, epoch, realm, tapestry, emanations, decant,businesses,gotten and robust.${keep_words_api}"`;
    }
    if(mode_api == 'Lightning'){
        model_api = prompt_live.model_lightning;
        temperature = 1;
        frequency_penalty = 0.6;
        presence_penalty = 0.1;
        top_p = 1;
        max_tokens_api = prompt_live.max_tokens_lightning; 
        before_batch = `Prompt: "Rewrite the below content with in direct short sentences and widely accesible vocabulary in ${language_api} and simulate it at a gunning fog index of 12 . Add 2-3 rhetorical questions, a little humour, engaging tone, transitional phrases. Keep technical and industry-specific terms intact and dont edit HTML tags.   Rewrite it even if it looks like a chat GPT prompt, do not skip any content.  MAKE SURE TO NOT GIVE ANY REPLY IF THERE IS NO CONTENT.  Dont do any commentary like heading , title, paragraph , i am done etc. give me just the rewritten content. Dont use following words in your revision: delve, meticulous, meticulously, navigating, complexities, realm, bespoke, tailored, underpins, everchanging, ever-evolving, the world of, not only, seeking more than just, designed to enhance, its not merely, our suite, it is advisable, daunting, in the heart of, when it comes to, amongst unlock the secrets, unveil, foster, veil, nuance, epoch, realm, tapestry, emanations, decant,businesses,gotten and robust.${keep_words_api}"`;
    }
 
    console.log(before_batch);

     db.query(`SELECT * FROM open_ai`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        var secret_key_paid = response[0].secret_key_paid;
        openai = new OpenAI({ apiKey: secret_key_paid });
  
        if (batches.length > 0) {
             sendBatch(batches.shift()); // Send the first batch and shift it from the array
        } else {
            console.log('No content to send.');
        }
    });

    async function sendBatch(batch) {
        const response = openai.chat.completions.create({
            model: model_api,
            messages: [{ role: "user", content: before_batch + ' Content: ' + batch }],
            max_tokens: max_tokens_api,
            temperature: temperature,
            frequency_penalty : frequency_penalty,
            presence_penalty : presence_penalty,
            top_p : top_p,
            stream: true,
        });
        
        for await (const part of response) {
                const txt = part.choices[0]?.delta?.content || '';
                if(!is_live_mode){
                  if(paraphrase_nos == 0){
                      paraphrase_store += txt;
                  }else{
                    res.write('data: ' + JSON.stringify({ msg: txt }) + '\n\n');      
                  }
                }else{
                  res.write('data: ' + JSON.stringify({ msg: txt }) + '\n\n');
                }
        }
        
                if (batches.length > 0) {
                    sendBatch(batches.shift()); // Recursively send the next batch
                } else {
                    res.write('data: ' + JSON.stringify({ msg : '[DONE]' }) + '\n\n');
                    res.end(); 

                    // update balance api
                    var word_decreased = 0;
                    if(balance_to_decrease_api == 'monthly'){
                        word_decreased = words_availbe_api - number_of_word_paraphrase;
                        if(word_decreased <= 30){
                           word_decreased = 0;
                        } 
                        db.query(`UPDATE user SET credits_availbe = '${word_decreased}' WHERE id = '${uid_api}'`, (err, response) => {
                            if (err) {
                                 console.error(err);
                                 return;
                            }
                        });
                    }
                    if(balance_to_decrease_api == 'onetime'){
                       word_decreased = words_availbe_api - number_of_word_paraphrase; 
                       if(word_decreased <= 30){
                           word_decreased = 0;
                       } 
                       db.query(`UPDATE user SET onetime_credit = '${word_decreased}' WHERE id = '${uid_api}'`, (err, response) => {
                            if (err) {
                                 console.error(err);
                                 return;
                            }
                        });
                    }

                }
    }
    
});
// End of creating api used by third party

// Get prices
app.get('/get_prices', cors(), async (req, res)=>{
    
    db.query(`SELECT * FROM products`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }

        res.status(200).json({ 'products' : response });    
    });
});


// Get coupon
app.get('/get_coupon', cors(), async (req, res)=>{
    
    db.query(`SELECT * FROM coupon`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }

        res.status(200).json({ 'coupons' : response });    
    });
});

app.get('/get_coupon_test', cors(), async (req, res)=>{
    
    db_test.query(`SELECT * FROM coupon`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }

        res.status(200).json({ 'coupons' : response });    
    });
});

// Generate API KEY
app.post('/generate_api_key', cors(), async (req, res)=>{
    
    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id;

    var timestamp = new Date().getTime();
    var randomNum = Math.random().toString(36).substring(2, 15).toUpperCase();
    var api_key = `api_${timestamp}${randomNum}`;

    db.query(`INSERT INTO api_key (api_key, user_id) VALUES ('${api_key}', '${user_id}')`, (err, response) => {
            if (err) {
               console.error(err);
               return;
            }
            res.status(200).json({'status' : 'success', 'api_key' : api_key});
        });
});

// Get API KEY
app.post('/get_api_key', cors(), async (req, res)=>{
    
    res.set('Access-Control-Allow-Origin', '*');
    
    var user_id = req.body.user_id;

    db.query(`SELECT * FROM api_key WHERE user_id = ${user_id}`, (err, response) => {
            if (err) {
               console.error(err);
               return;
            }
            
            if(response.length != 0){
                res.status(200).json({'status' : 'success', 'api_key' : response[0].api_key});
            }else{
               res.status(200).json({'status' : 'not found'});
            }
        });
});

// Sign up
app.post('/register', cors(), async (req, res)=>{
    
    res.set('Access-Control-Allow-Origin', '*');
    var email = req.body.email;
    var user_exist = false;

    db.query(`SELECT * FROM user WHERE email = '${email}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length != 0){
            res.status(200).json({'id' : 0, 'status' : 'User already exist!'});
        }else{

    var password = req.body.password;
    var encryptedPass = '';
    bcrypt.genSalt(saltRounds).then(salt => {
        console.log('Salt: ', salt);
        return bcrypt.hash(password, salt).then(hash => {
          console.log('Hash: ', hash);
          encryptedPass = hash;
          let currentDate = new Date().toJSON().slice(0, 10);
          db.query(`INSERT INTO user (email, password, status, daily_quota, quota_updated_date) VALUES ('${email}', '${encryptedPass}', 0, 1500, '${currentDate}')`, (err, response) => {
            if (err) {
               console.error(err);
               return;
            }
            sendMail(email, response.insertId);
            var dt = new Date();  
            var edt = dt.toLocaleString('en-US', {
              timeZone: 'America/New_York',
              dateStyle: 'full',
              timeStyle: 'full'
            });
            res.status(200).json({'id' : response.insertId, 'user_email' : email, 'login' : 'on-verification', 'time' : edt, 'role' : 0});
        });
    
       });
    }); 
        }

    });
});

// Sign in
app.post('/login', cors(), async (req, res)=>{
    
    res.set('Access-Control-Allow-Origin', '*');
    var email = req.body.email;
    var password = req.body.password;

    db.query(`SELECT * FROM user WHERE email = '${email}'`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
            res.status(200).json({'login' : 'failure'});
        }else{
               var pass = response[0].password;
               const validPassword = await bcrypt.compare(password, pass);
               if(!validPassword){
                   res.status(200).json({'login' : 'failure'}); 
               }else{
                 var dt = new Date();  
                 var edt = dt.toLocaleString('en-US', {
                       timeZone: 'America/New_York',
                       dateStyle: 'full',
                       timeStyle: 'full'
                 });
                 res.status(200).json({ 'login' : 'success', 'id' : response[0].id, 'time' : edt, 'user_email' : response[0].email, 'role' : response[0].role });
                
            }
        }
    });
});


app.post('/forgot_password', cors(), async (req, res)=>{
     
     res.set('Access-Control-Allow-Origin', '*');
     var email = req.body.email;

     let otp = Math.floor((Math.random() * 10000) + 1);
     db.query(`INSERT INTO reset_password (email, otp) VALUES ('${email}', '${otp}')`, (err, response) => {
          if (err) {
               console.error(err);
               return;
          }
          let sent_email = sendMailOTP(email, otp);
          if(sent_email) {
               res.status(200).json({'status' : 'success'});
          }
    });
});

app.post('/add_record', cors(), async (req, res) => {
     
     res.set('Access-Control-Allow-Origin', '*');
     var user_id = req.body.user_id;
     var user_email = req.body.user_email;
     var mode = req.body.mode;
     var input = req.body.input.replace(/["']/g, "");
     var output = req.body.output.replace(/["']/g, "");
     var quota_used = req.body.quota_used;
     var words_used = req.body.words_used;
     console.log(quota_used);

     db.query(`INSERT INTO user_record (input, output, mode, user_email) VALUES ('${input}', '${output}', '${mode}', '${user_email}')`, (err, response) => {
          if (err) {
               console.error(err);
               return;
          }
          
          res.status(200).json({'status' : 'success'}); 
    });

     db.query(`UPDATE user SET quota_used = '${quota_used}', words_used = '${words_used}' WHERE id = '${user_id}'`, (err, response) => {
          if (err) {
               console.error(err);
               return;
          }
    });

});


app.post('/reset_password', cors(), async (req, res)=>{
     
     res.set('Access-Control-Allow-Origin', '*');
     var email = req.body.email;
     var new_password = req.body.new_password;
     var otp = req.body.otp;

     db.query(`SELECT * FROM reset_password WHERE email = '${email}' AND otp = '${otp}'`, (err, response) => {
          if (err) {
               console.error(err);
               return;
          }
          if(response.length == 0){
               res.status(200).json({'status' : 'failure'});
          }else{
              var encryptedPass = '';
              bcrypt.genSalt(saltRounds).then(salt => {
                console.log('Salt: ', salt);
                return bcrypt.hash(new_password, salt).then(hash => {
                  console.log('Hash: ', hash);
                  encryptedPass = hash;

                  db.query(`UPDATE user SET password = '${encryptedPass}' WHERE email = '${email}'`, (err, response) => {
                       if (err) {
                            console.error(err);
                            return;
                       }
                       db.query(`DELETE FROM reset_password WHERE email = '${email}'`, (err, response) => {
                            res.status(200).json({'status' : 'success'}); 
                       });
                  });
                });
              }); 
          }
    });
});

// Sending Mail for Onetime Purchase
async function sendMailOTP(email, otp) {

try{
  // Send the email
  let info = await transporter.sendMail({
    from: '"OneClickHuman" <info@oneclickhuman.com>',
    to: email,
    subject: "Reset your OneclickHuman Password | OTP",
    template: 'otp',
    context: { rotp : otp }
  });
  
  if(info.messageId != null){
       return true;    
  }
}catch(error){
    console.log(error);
    return false;   
  }
}

// Delete account
app.post('/delete_account', cors(), async (req, res)=>{
    
    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id;

    db.query(`SELECT * FROM user WHERE id = '${user_id}'`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
            res.status(200).json({'status' : 'Account not found'});
        }else{
           db.query(`DELETE FROM user WHERE id = '${user_id}'`, async (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }
                res.status(200).json({'status' : 'success'});
           });
        }
    });
});

// Delete account
app.post('/delete_account_test', cors(), async (req, res)=>{
    
    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id;

    db_test.query(`SELECT * FROM user WHERE id = '${user_id}'`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
            res.status(200).json({'status' : 'Account not found'});
        }else{
           db_test.query(`DELETE FROM user WHERE id = '${user_id}'`, async (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }
                res.status(200).json({'status' : 'success'});
           });
        }
    });
});

// Email verification
app.get('/verification/:id', (req, res) => {
    
    var user_id = req.params.id;
    db.query(`UPDATE user SET status = '1' WHERE id = '${user_id}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        res.sendFile(__dirname + "/html/index.html");
    }); 
});

// Email verification
app.get('/verification_test/:id', (req, res) => {
    
    var user_id = req.params.id;
    db_test.query(`UPDATE user SET status = '1' WHERE id = '${user_id}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        res.sendFile(__dirname + "/html/index_test.html");
    }); 
});

// Change Email
app.post('/change_email', cors(), async (req, res)=>{
    
    res.set('Access-Control-Allow-Origin', '*');
    var email = req.body.email;
    var password = req.body.password;
    var user_id = req.body.user_id;

    db.query(`SELECT * FROM user WHERE id = '${user_id}'`, async (err, response) => {
               if (err) {
                   console.error(err);
                   return;
               }
               var pass = response[0].password;
               const validPassword = await bcrypt.compare(password, pass);
               if(!validPassword){
                   res.status(200).json({'status' : 'failure', 'password_matched' : 'failure'}); 
               }else{
                  db.query(`UPDATE user SET email = '${email}' WHERE id = '${user_id}'`, (err, response) => {
                      if (err) {
                        console.error(err);
                        return;
                      }
                      res.status(200).json({'status' : 'success'});
                  });   
               }
    });
});

// Change Password
app.post('/change_password', cors(), async (req, res)=>{
    
    res.set('Access-Control-Allow-Origin', '*');
    var current_password = req.body.current_password;
    var new_password = req.body.new_password;
    var user_id = req.body.user_id;

    db.query(`SELECT * FROM user WHERE id = '${user_id}'`, async (err, response) => {
               if (err) {
                   console.error(err);
                   return;
               }
               var pass = response[0].password;
               const validPassword = await bcrypt.compare(current_password, pass);
               if(!validPassword){
                   res.status(200).json({'status' : 'failure', 'password_matched' : 'failure'}); 
               }else{
                   var encryptedPass = '';
                   bcrypt.genSalt(saltRounds).then(salt => {
                     return bcrypt.hash(new_password, salt).then(hash => {
                      console.log('Hash: ', hash);
                      encryptedPass = hash;
                      
                      db.query(`UPDATE user SET password = '${encryptedPass}' WHERE id = '${user_id}'`, (err, response) => {
                          if (err) {
                              console.error(err);
                              return;
                          }
                          res.status(200).json({'status' : 'success'});
                       }); 

                    });
                });  
            }
    });
});

// Check quota

app.post('/checkquota_test', cors(), async (req, res) => {
    
    res.set('Access-Control-Allow-Origin', '*');
    var uid = req.body.user_id;
    console.log(uid);
    let currentDate = new Date().toJSON().slice(0, 10);
    var credits_availbe = 0;
    var subscrption_status = 0;
    var cancellation_status = 0;
    var onetime_plan = 0;
    var onetime_credit = 0;
    var monthly_plan = 0;
    var subscription_amount = 0;
    var onetime_amount = 0;
    var subscription_renewal_date;
    var is_lifetime_active = 0;
    var lifetime_plan = 0;
    var lifetime_refill_date;
    var lifetime_next_refill_date;
    var lifetime_credits = 0;
    var max_lifetime_used = 0;
    var quota_used = 0;
    var currency = '';
    var is_renewal_date_crossed = 0;
    var role = 0;
    var email_verification = false;
    var subscription_id = '';
    var created_at;
    
    db_test.query(`SELECT * FROM user WHERE id = '${uid}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        subscrption_status = response[0].subscrption_status;
        cancellation_status = response[0].cancellation_status;
        monthly_plan = response[0].monthly_plan;
        credits_availbe = response[0].credits_availbe;
        subscription_amount = response[0].subscrption_amount;
        subscription_id = response[0].subscription_id;
        onetime_credit = response[0].onetime_credit;
        onetime_plan = response[0].onetime_plan;
        onetime_amount = response[0].onetime_amount;
        subscription_renewal_date = response[0].subscription_renewal_date;
        is_lifetime_active = response[0].is_lifetime_active;
        lifetime_plan = response[0].lifetime_plan;
        lifetime_refill_date = response[0].lifetime_refill_date;
        lifetime_next_refill_date = response[0].lifetime_next_refill_date;
        lifetime_credits = response[0].lifetime_credits;
        max_lifetime_used = response[0].max_lifetime_used,
        quota_used = response[0].quota_used;
        currency = response[0].currency;
        role = response[0].role;
        created_at = response[0].created_at;
        
        if(response[0].status == 1){
            email_verification = true;
        }else{
           email_verification = false;
        }

        db_test.query(`SELECT * FROM user WHERE quota_updated_date = '${currentDate}' AND id = '${uid}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
              db_test.query(`UPDATE user SET daily_quota = 1500, quota_updated_date = '${currentDate}' WHERE id = '${uid}'`, (err, response) => {
                  if (err) {
                      console.error(err);
                      return;
                  }
                  console.log(response);
                  if (new Date() > new Date(subscription_renewal_date)){
                      is_renewal_date_crossed = 1;
                  }else{
                      is_renewal_date_crossed = 0;
                  }
                  if(cancellation_status == 1 && is_renewal_date_crossed == 1){
                       db_test.query(`UPDATE user SET cancellation_status = 0, subscrption_status = 0, subscrption_amount = 0, credits_availbe = 0, monthly_plan = 0 WHERE id = '${uid}'`, (err, response) => {
                         res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-allowed', 'quota' : 700, 'current_date' : currentDate, 'credits_availbe' : 0, 'subscrption_status' : 0, 'cancellation_status' : 0, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : 0, 'subscription_amount' : 0, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                       });
                  }else{
                     res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-allowed', 'quota' : 700, 'current_date' : currentDate, 'credits_availbe' : credits_availbe, 'subscrption_status' : subscrption_status, 'cancellation_status' : cancellation_status, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : monthly_plan, 'subscription_amount' : subscription_amount, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                  }
                });  
        }else{
           var quota = response[0].daily_quota;
           if(quota == 0){
                  if (new Date() > new Date(subscription_renewal_date)){
                      is_renewal_date_crossed = 1;
                  }else{
                      is_renewal_date_crossed = 0;
                  }
                  if(cancellation_status == 1 && is_renewal_date_crossed == 1){
                       db_test.query(`UPDATE user SET cancellation_status = 0, subscrption_status = 0, subscrption_amount = 0, credits_availbe = 0, monthly_plan = 0 WHERE id = '${uid}'`, (err, response) => {
                        res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-not-allowed-ss', 'quota' : 0, 'current_date' : currentDate, 'credits_availbe' : 0, 'subscrption_status' : 0, 'cancellation_status' : 0, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : 0, 'subscription_amount' : 0, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                       });
                  }else{
                    res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-not-allowed-ss', 'quota' : 0, 'current_date' : currentDate, 'credits_availbe' : credits_availbe, 'subscrption_status' : subscrption_status, 'cancellation_status' : cancellation_status, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : monthly_plan, 'subscription_amount' : subscription_amount, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                  }
           }else{
               if (new Date() > new Date(subscription_renewal_date)){
                      is_renewal_date_crossed = 1;
                  }else{
                      is_renewal_date_crossed = 0;
                  }
                  if(cancellation_status == 1 && is_renewal_date_crossed == 1){
                       db_test.query(`UPDATE user SET cancellation_status = 0, subscrption_status = 0, subscrption_amount = 0, credits_availbe = 0, monthly_plan = 0 WHERE id = '${uid}'`, (err, response) => {
                       res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-allowed', 'quota' : quota, 'current_date' : currentDate, 'credits_availbe' : 0, 'subscrption_status' : 0, 'cancellation_status' : 0, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : 0, 'subscription_amount' : 0, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});       
                       });
                  }else{
                    res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-allowed', 'quota' : quota, 'current_date' : currentDate, 'credits_availbe' : credits_availbe, 'subscrption_status' : subscrption_status, 'cancellation_status' : cancellation_status, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : monthly_plan, 'subscription_amount' : subscription_amount, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                  }
           }
        }
    });
    
    });
});

app.post('/checkquota', cors(), async (req, res) => {
    
    res.set('Access-Control-Allow-Origin', '*');
    var uid = req.body.user_id;
    console.log(uid);
    let currentDate = new Date().toJSON().slice(0, 10);
    var credits_availbe = 0;
    var subscrption_status = 0;
    var cancellation_status = 0;
    var onetime_plan = 0;
    var onetime_credit = 0;
    var monthly_plan = 0;
    var subscription_amount = 0;
    var onetime_amount = 0;
    var subscription_renewal_date;
    var is_lifetime_active = 0;
    var lifetime_plan = 0;
    var lifetime_refill_date;
    var lifetime_next_refill_date;
    var lifetime_credits = 0;
    var max_lifetime_used = 0;
    var quota_used = 0;
    var currency = '';
    var is_renewal_date_crossed = 0;
    var role = 0;
    var email_verification = false;
    var subscription_id = '';
    var created_at;
    
    db.query(`SELECT * FROM user WHERE id = '${uid}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        subscrption_status = response[0].subscrption_status;
        cancellation_status = response[0].cancellation_status;
        monthly_plan = response[0].monthly_plan;
        credits_availbe = response[0].credits_availbe;
        subscription_amount = response[0].subscrption_amount;
        subscription_id = response[0].subscription_id;
        onetime_credit = response[0].onetime_credit;
        onetime_plan = response[0].onetime_plan;
        onetime_amount = response[0].onetime_amount;
        subscription_renewal_date = response[0].subscription_renewal_date;
        is_lifetime_active = response[0].is_lifetime_active;
        lifetime_plan = response[0].lifetime_plan;
        lifetime_refill_date = response[0].lifetime_refill_date;
        lifetime_next_refill_date = response[0].lifetime_next_refill_date;
        lifetime_credits = response[0].lifetime_credits;
        max_lifetime_used = response[0].max_lifetime_used,
        quota_used = response[0].quota_used;
        currency = response[0].currency;
        role = response[0].role;
        created_at = response[0].created_at;
        
        if(response[0].status == 1){
            email_verification = true;
        }else{
           email_verification = false;
        }

        db.query(`SELECT * FROM user WHERE quota_updated_date = '${currentDate}' AND id = '${uid}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
              db.query(`UPDATE user SET daily_quota = 1500, quota_updated_date = '${currentDate}' WHERE id = '${uid}'`, (err, response) => {
                  if (err) {
                      console.error(err);
                      return;
                  }
                  console.log(response);
                  if (new Date() > new Date(subscription_renewal_date)){
                      is_renewal_date_crossed = 1;
                  }else{
                      is_renewal_date_crossed = 0;
                  }
                  if(cancellation_status == 1 && is_renewal_date_crossed == 1){
                       db.query(`UPDATE user SET cancellation_status = 0, subscrption_status = 0, subscrption_amount = 0, credits_availbe = 0, monthly_plan = 0 WHERE id = '${uid}'`, (err, response) => {
                         res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-allowed', 'quota' : 1500, 'current_date' : currentDate, 'credits_availbe' : 0, 'subscrption_status' : 0, 'cancellation_status' : 0, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : 0, 'subscription_amount' : 0, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                       });
                  }else{
                     res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-allowed', 'quota' : 1500, 'current_date' : currentDate, 'credits_availbe' : credits_availbe, 'subscrption_status' : subscrption_status, 'cancellation_status' : cancellation_status, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : monthly_plan, 'subscription_amount' : subscription_amount, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                  }
                });  
        }else{
           var quota = response[0].daily_quota;
           if(quota == 0){
                  if (new Date() > new Date(subscription_renewal_date)){
                      is_renewal_date_crossed = 1;
                  }else{
                      is_renewal_date_crossed = 0;
                  }
                  if(cancellation_status == 1 && is_renewal_date_crossed == 1){
                       db.query(`UPDATE user SET cancellation_status = 0, subscrption_status = 0, subscrption_amount = 0, credits_availbe = 0, monthly_plan = 0 WHERE id = '${uid}'`, (err, response) => {
                        res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-not-allowed-ss', 'quota' : 0, 'current_date' : currentDate, 'credits_availbe' : 0, 'subscrption_status' : 0, 'cancellation_status' : 0, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : 0, 'subscription_amount' : 0, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                       });
                  }else{
                    res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-not-allowed-ss', 'quota' : 0, 'current_date' : currentDate, 'credits_availbe' : credits_availbe, 'subscrption_status' : subscrption_status, 'cancellation_status' : cancellation_status, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : monthly_plan, 'subscription_amount' : subscription_amount, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                  }
           }else{
               if (new Date() > new Date(subscription_renewal_date)){
                      is_renewal_date_crossed = 1;
                  }else{
                      is_renewal_date_crossed = 0;
                  }
                  if(cancellation_status == 1 && is_renewal_date_crossed == 1){
                       db.query(`UPDATE user SET cancellation_status = 0, subscrption_status = 0, subscrption_amount = 0, credits_availbe = 0, monthly_plan = 0 WHERE id = '${uid}'`, (err, response) => {
                       res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-allowed', 'quota' : quota, 'current_date' : currentDate, 'credits_availbe' : 0, 'subscrption_status' : 0, 'cancellation_status' : 0, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : 0, 'subscription_amount' : 0, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});       
                       });
                  }else{
                    res.status(200).json({'user_created': created_at, 'email_verification': email_verification, 'status' : 'request-allowed', 'quota' : quota, 'current_date' : currentDate, 'credits_availbe' : credits_availbe, 'subscrption_status' : subscrption_status, 'cancellation_status' : cancellation_status, 'onetime_credit' : onetime_credit, 'onetime_plan' : onetime_plan, 'monthly_plan' : monthly_plan, 'subscription_amount' : subscription_amount, 'onetime_amount' : onetime_amount, 'subscription_renewal_date' : subscription_renewal_date, 'is_lifetime_active' : is_lifetime_active, 'lifetime_plan' : lifetime_plan, 'lifetime_refill_date' : lifetime_refill_date, 'lifetime_next_refill_date' : lifetime_next_refill_date, 'lifetime_credits' : lifetime_credits, 'max_lifetime_used' : max_lifetime_used, 'quota_used' : quota_used, 'currency' : currency, 'role' : role, 'subscription_id' : subscription_id});
                  }
           }
        }
    });
    
    });
});


// Update lifetime refill date
app.post('/update_lifetime_refill_date', cors(), async (req, res) => {
    
    res.set('Access-Control-Allow-Origin', '*');
    var uid = req.body.user_id;
    var start_dt = new Date(); 
    var lifetime_refill_date = start_dt.toJSON().slice(0, 10);
    var lifetime_next_refill_date = new Date(new Date().setDate(start_dt.getDate() + 30)).toJSON().slice(0, 10);

    db.query(`UPDATE user SET lifetime_refill_date = '${lifetime_refill_date}', lifetime_next_refill_date = '${lifetime_next_refill_date}' WHERE id = '${uid}'`, (err, response) => {
         if (err) {
              console.error(err);
              return;
         }
         res.status(200).json({'status' : 'success'});
    });
});

// Update quota
app.post('/updatequota', cors(), async (req, res) => {
    
    res.set('Access-Control-Allow-Origin', '*');
    var uid = req.body.user_id;
    var quota_to_decresed = req.body.quota_to_decresed;
    var decreased_words = req.body.decreased_words;

    db.query(`SELECT * FROM user WHERE id = '${uid}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }

        var email = response[0].email;
        var subscrption_status = response[0].subscrption_status;
        var onetime_credit = response[0].onetime_credit;
        var credits_availbe = response[0].credits_availbe;
        var lifetime_credits = response[0].lifetime_credits;
        var daily_quota = response[0].daily_quota;
        var updated_field = '';
        var quota_decreased = 0; 

        if(quota_to_decresed == 1){
             updated_field = 'daily_quota';
             quota_decreased = daily_quota - decreased_words;
        }
        if(quota_to_decresed == 2){
             updated_field = 'credits_availbe';
             quota_decreased = credits_availbe - decreased_words; 
        }
        if(quota_to_decresed == 3){
             updated_field = 'onetime_credit';
             quota_decreased = onetime_credit - decreased_words; 

             if(quota_decreased == 0) {
                  sendMailLifetimeExpired(email);
             }
        }
        if(quota_to_decresed == 4){
             updated_field = 'lifetime_credits';
             quota_decreased = lifetime_credits - decreased_words; 
        }
        if(quota_decreased <= 30){
                 quota_decreased = 0;
        }         

        db.query(`UPDATE user SET ${updated_field} = '${quota_decreased}' WHERE id = '${uid}'`, (err, response) => {
             if (err) {
                console.error(err);
                return;
              }
              res.status(200).json({'quota_decreased' : quota_decreased});
        });
    
    });
});

// Update quota
app.post('/updatequota_test', cors(), async (req, res) => {
    
    res.set('Access-Control-Allow-Origin', '*');
    var uid = req.body.user_id;
    var quota_to_decresed = req.body.quota_to_decresed;
    var decreased_words = req.body.decreased_words;

    db_test.query(`SELECT * FROM user WHERE id = '${uid}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }

        var email = response[0].email;
        var subscrption_status = response[0].subscrption_status;
        var onetime_credit = response[0].onetime_credit;
        var credits_availbe = response[0].credits_availbe;
        var lifetime_credits = response[0].lifetime_credits;
        var daily_quota = response[0].daily_quota;
        var updated_field = '';
        var quota_decreased = 0; 

        if(quota_to_decresed == 1){
             updated_field = 'daily_quota';
             quota_decreased = daily_quota - decreased_words;
        }
        if(quota_to_decresed == 2){
             updated_field = 'credits_availbe';
             quota_decreased = credits_availbe - decreased_words; 
        }
        if(quota_to_decresed == 3){
             updated_field = 'onetime_credit';
             quota_decreased = onetime_credit - decreased_words; 

             if(quota_decreased == 0) {
                  sendMailLifetimeExpired(email);
             }
        }
        if(quota_to_decresed == 4){
             updated_field = 'lifetime_credits';
             quota_decreased = lifetime_credits - decreased_words; 
        }
        if(quota_decreased <= 30){
                 quota_decreased = 0;
        }         

        db_test.query(`UPDATE user SET ${updated_field} = '${quota_decreased}' WHERE id = '${uid}'`, (err, response) => {
             if (err) {
                console.error(err);
                return;
              }
              res.status(200).json({'quota_decreased' : quota_decreased});
        });
    
    });
});

// Match Lifetime code
app.post('/match_lifetime_code', cors(), async (req, res)=>{
    
    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id;
    var lifetime_code = req.body.lifetime_code;
    var max_lifetime_used = 0;
    var lifetime_credits = 0;
    var current_lifetime_credits = 0;
    console.log(user_id);

    db.query(`SELECT * FROM lifetime_codes WHERE code = '${lifetime_code}'`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
            res.status(200).json({'status' : 'Code does not exist!', 'color': 'red', 'allowed_next_time' : 0, 'message_extra' : ''});
        }else{
            if(response[0].is_used == 1){
                 res.status(200).json({'status' : 'The code is already used!', 'color': 'red', 'allowed_next_time' : 0, 'message_extra' : ''});     
            }else{
               db.query(`SELECT * FROM user WHERE id = '${user_id}'`, async (err, response) => {
                   if (err) {
                     console.error(err);
                     return;
                    }
                    current_lifetime_credits = response[0].lifetime_credits;
                    if (response[0].max_lifetime_used == 3){
                         res.status(200).json({'status' : 'Sorry, You have already redeemed the maximum number of codes.', 'color': 'red', 'allowed_next_time' : 0, 'message_extra' : 'create new account'}); 
                    }else{
                       max_lifetime_used = response[0].max_lifetime_used; 
                       db.query(`UPDATE lifetime_codes set is_used = 1 WHERE code = '${lifetime_code}'`, async(err, response) => {
                            if (err) {
                                console.error(err);
                                return;
                             }
                             max_lifetime_used++;
                             var lifetime_plan = 0;
                             var lifetime_credits = 0;
                             var allowed_next_time = 0;
                             var message = '';
                             var send_email_admin = 0;
                             switch (max_lifetime_used) {
                                case 1:
                                lifetime_plan = 16000;
                                lifetime_credits = 16000;
                                allowed_next_time = 1;
                                message = 'Congratulations, your Lifetime plan has been activated. <br> ( You will get 16 credits every month )';
                                send_email_admin = 1;
                                break;

                                case 2:
                                lifetime_plan = 32000;
                                lifetime_credits = 32000 - (16000 - current_lifetime_credits);
                                allowed_next_time = 1;
                                message = 'Congratulations, your Lifetime plan has been upgraded to license tier 2. <br> ( You will get 32 credits every month )';
                                break;

                                case 3:
                                lifetime_plan = 50000;
                                lifetime_credits = 50000 - (32000 - current_lifetime_credits);
                                allowed_next_time = 0;
                                message = 'Congratulations, your Lifetime plan has been  upgraded to license tier 3. <br> ( You will get 50 credits every month )';
                                break;
                             }
                             var start_dt = new Date();  
                             var lifetime_refill_date = start_dt.toJSON().slice(0, 10);
                             var lifetime_next_refill_date = new Date(new Date().setDate(start_dt.getDate() + 30)).toJSON().slice(0, 10);  
                             db.query(`UPDATE user SET 
                                           is_lifetime_active = 1,
                                           lifetime_plan = '${lifetime_plan}',
                                           lifetime_credits = '${lifetime_credits}',
                                           max_lifetime_used = '${max_lifetime_used}',
                                           lifetime_refill_date = '${lifetime_refill_date}',
                                           lifetime_next_refill_date = '${lifetime_next_refill_date}'
                                           WHERE id = '${user_id}'`,
                                    async(err, response) => {
                                      if (err) {
                                           console.error(err);
                                           return;
                                      }
                                   res.status(200).json({'status' : message, 'color': 'green', 'allowed_next_time': allowed_next_time, 'message_extra' : ''});
                                   if(send_email_admin == 1){
                                       sendLifetimeMail();
                                   }
                             });
                       });   
                    }
               });
            }
           //res.status(200).json({'status' : 'success'});
        }
    });
});

// Create Enquire
app.post('/create_enquire', cors(), async (req, res)=>{
      res.set('Access-Control-Allow-Origin', '*');
      var first_name = req.body.first_name;
      var last_name = req.body.last_name;
      var subject = req.body.subject;
      var message = req.body.message;
      var email = req.body.email;
      
      sendMailEnquire(first_name, last_name, email, subject, message);
      res.status(200).json({'status' : 'success'});
});

const sendEvent = (req, res) => {
    res.statusCode = 200;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.setHeader("Content-Type", "text/event-stream");

  const sseId = new Date().toDateString();
  const uid = req.params.id;

  setInterval(() => {
    db.query(`SELECT * FROM user WHERE id = '${uid}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        writeEvent(res, sseId, response[0].status);
    });  
  }, SEND_INTERVAL);

  writeEvent(res, sseId, uid);
};

app.get('/sse/:id', (req, res)=>{

  sendEvent(req, res);
});

app.post('/paraphrase', cors(), async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    var words = req.body.text;
    var command = req.body.command;
    var frequency = req.body.frequency;
    var presence = req.body.presence;
    var temp = req.body.temp;

    runCompletion(words, command, frequency, presence, temp).then((data) => {
       res.status(200).json({'data' : data.message, 'token' : data.token});
    });

});

/*app.get('/update_sub', async (req, res) => {
    var sub = await stripe.subscriptions.update(
  'sub_1NSbcf2eZvKYlo2CmnTvkvo9'
);
}); */

// subscription purchase stripe api
app.post('/create-checkout-session', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  var email_address = req.body.email_address;
  const subscription = req.body.subscription;
  const promocode = req.body.promocode;
  let coupon = '';

  db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${email_address}', 'User clicked on purchase button for subscription')`, async (err, response) => {
     if (err) {
            console.error(err);
            return;
     }
  });

  db.query(`SELECT * FROM coupon WHERE code = '${promocode}'`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
            res.status(200).json({'status' : 'Promocode does not exist'});
            return;
        }else{

  coupon = response[0].coupon;
  var off = response[0].discount;
  var affiliator = response[0].affiliator;
  var plan = 0;
  var amnt = 0;
  var currency = '';

  db.query(`INSERT INTO affiliation (affiliator, user_email, promocode, type) VALUES ('${affiliator}', '${email_address}', '${promocode}', 1)`, async (err, response) => {
     if (err) {
            console.error(err);
            return;
     }
  });

  console.log('Price number: ' + subscription);
  
  switch (subscription) {
      
      case 'price_1Q7wAQAEY1f0FEsivEsKsB4v':
      plan = 500;
      amnt = 150;
      currency = 'USD';
      break;

      case 'price_1Q7w9nAEY1f0FEsi9EeXt2fN':
      plan = 200;
      amnt = 68;
      currency = 'USD';
      break;

      case 'price_1Q7w9EAEY1f0FEsiav832wDn':
      plan = 100;
      amnt = 38;
      currency = 'USD';
      break;

      case 'price_1Q7w8eAEY1f0FEsiWNzYwRSS':
      plan = 50;
      amnt = 20;
      currency = 'USD';
      break;
  }
  var real_amount_paid = amnt - amnt*off/100;

  db.query(`SELECT * FROM stripe WHERE owner = 'jonas'`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        var secret_key = response[0].secret_key;
        stripe = require('stripe')(secret_key);

        let session = await stripe.checkout.sessions.create({
              billing_address_collection: 'auto',
              line_items: [
                {
                  price: subscription,
                  // For metered billing, do not pass quantity
                  quantity: 1,
                },
              ],
              mode: 'subscription',
              discounts: [{
                coupon: coupon,
              }],
              customer_email: email_address,
              success_url: `https://oneclickhuman.com/success?success=true&plan=${plan}&amnt=${real_amount_paid}&currency=${currency}&subscription=true&session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `https://oneclickhuman.com/success?success=false`,
         });

        db.query(`INSERT INTO payment_session (user_email, session_id, plan, amount_paid, currency) VALUES ('${email_address}', '${session.id}', '${plan}', '${real_amount_paid}', '${currency}')`, async (err, response) => {
          if (err) {
            console.error(err);
            return;
          }
        });

        db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${email_address}', 'Stripe executed payment link for subscription')`, async (err, response) => {
           if (err) {
              console.error(err);
              return;
           }
        });

        db.query(`UPDATE user SET payment_initiated = 1 WHERE email = '${email_address}'`, async (err, response) => {
           if (err) {
              console.error(err);
              return;
          }
        });

         res.redirect(303, session.url);

    });

    }
  });

});

app.post('/create-checkout-session-test', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  var email_address = req.body.email_address;
  const subscription = req.body.subscription;
  const promocode = req.body.promocode;
  let coupon = '';

  db_test.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${email_address}', 'User click purchase button')`, async (err, response) => {
     if (err) {
            console.error(err);
            return;
     }
  });

  db_test.query(`SELECT * FROM coupon WHERE code = '${promocode}'`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
            res.status(200).json({'status' : 'Promocode does not exist'});
            return;
        }else{

  coupon = response[0].coupon;
  var off = response[0].discount;
  var affiliator = response[0].affiliator;
  var plan = 0;
  var amnt = 0;
  var currency = '';

  db_test.query(`INSERT INTO affiliation (affiliator, user_email, promocode, type) VALUES ('${affiliator}', '${email_address}', '${promocode}', 1)`, async (err, response) => {
     if (err) {
            console.error(err);
            return;
     }
  });

  console.log('Price number: ' + subscription);
  
  switch (subscription) {
    case 'price_1PGbHFGH2w5PvhwHoEODFXHp':
      plan = 50;
      amnt = 20;
      currency = 'USD';
      break;
      
    case 'price_1QRTzcGH2w5PvhwH0LFuHxh3':
      plan = 200;
      amnt = 68;
      currency = 'USD';
      break;
      
    case 'price_1PGbHFGH2w5PvhwHoEODFXHp':
      plan = 500;
      amnt = 150;
      currency = 'USD';
      break;  
  }
  var real_amount_paid = amnt - amnt*off/100;

  db_test.query(`SELECT * FROM stripe`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }

        let session = await stripe.checkout.sessions.create({
              billing_address_collection: 'auto',
              line_items: [
                {
                  price: subscription,
                  // For metered billing, do not pass quantity
                  quantity: 1,
                },
              ],
              mode: 'subscription',
              discounts: [{
                coupon: coupon,
              }],
              customer_email: email_address,
              success_url: `https://next.oneclickhuman.com/success?success=true&plan=${plan}&amnt=${real_amount_paid}&currency=${currency}&subscription=true&session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `https://next.oneclickhuman.com/?success=false`,
         });

        db_test.query(`INSERT INTO payment_session (user_email, session_id, plan, amount_paid, currency) VALUES ('${email_address}', '${session.id}', '${plan}', '${real_amount_paid}', '${currency}')`, async (err, response) => {
          if (err) {
            console.error(err);
            return;
          }
        });
      
         db_test.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${email_address}', 'Stripe executed payment link')`, async (err, response) => {
           if (err) {
              console.error(err);
              return;
          }
        });

        db_test.query(`UPDATE user SET payment_initiated = 1 WHERE email = '${email_address}'`, async (err, response) => {
           if (err) {
              console.error(err);
              return;
          }
        });
          
         res.redirect(303, session.url);

    });

    }
  });

});

// onetime purchase stripe api
app.post('/create-checkout-session-onetime', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  var email_address = req.body.email_address;
  const onetime_purchase = req.body.onetime_purchase;
  const promocode = req.body.promocode;
  let coupon = '';

  db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${email_address}', 'User clicked on purchase button for onetime plan')`, async (err, response) => {
     if (err) {
            console.error(err);
            return;
     }
  });

  db.query(`SELECT * FROM coupon WHERE code = '${promocode}'`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        if(response.length == 0){
            res.status(200).json({'status' : 'Promocode does not exist'});
            return;
        }else{

  coupon = response[0].coupon;
  var off = response[0].discount;
  var plan = 0;
  var amnt = 0;
  var currency = '';

  switch (onetime_purchase) {      

      case 'price_1Q7vwjAEY1f0FEsiJNf368yX':
      plan = 500;
      amnt = 300;
      currency = 'USD';
      break;

      case 'price_1Q7vwBAEY1f0FEsied3DhJfz':
      plan = 200;
      amnt = 135;
      currency = 'USD';
      break;

      case 'price_1Q7vvaAEY1f0FEsi4Kiokguf':
      plan = 100;
      amnt = 80;
      currency = 'USD';
      break;

      case 'price_1Q7vv1AEY1f0FEsir0d1Csst':
      plan = 50;
      amnt = 40;
      currency = 'USD';
      break;
  }

  var real_amount_paid = amnt - amnt*off/100;

  db.query(`SELECT * FROM stripe WHERE owner = 'jonas'`, async (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        var secret_key = response[0].secret_key;
        stripe = require('stripe')(secret_key);

  let session = await stripe.checkout.sessions.create({
    billing_address_collection: 'auto',
    line_items: [
      {
        price: onetime_purchase,
        // For metered billing, do not pass quantity
        quantity: 1,
      },
    ],
    mode: 'payment',
    discounts: [{
      coupon: coupon,
    }],
    customer_email: email_address,
    success_url: `https://oneclickhuman.com/success?success=true&plan=${plan}&amnt=${real_amount_paid}&currency=${currency}&subscription=false&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://oneclickhuman.com/success?success=false`,
  });

    db.query(`INSERT INTO payment_session (user_email, session_id, plan, amount_paid, currency) VALUES ('${email_address}', '${session.id}', '${plan}', '${real_amount_paid}', '${currency}')`, async (err, response) => {
          if (err) {
            console.error(err);
            return;
          }
    });

    db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${email_address}', 'Stripe executed payment link for onetime payment')`, async (err, response) => {
           if (err) {
              console.error(err);
              return;
          }
    });

  res.redirect(303, session.url);
  
  });

    }
 });

});

// update records database for successful transaction
app.post('/update_payment_react', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  var email = req.body.email;
  var plan = req.body.plan;
  plan = parseInt(plan);
  plan = plan*1000; 
  var subscription = req.body.subscription;
  var currency = req.body.currency;
  var amnt = req.body.amnt;

  db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${email}', 'Return url executed at user browser')`, async (err, response) => {
      if (err) {
            console.error(err);
            return;
      }
  });

  db.query(`SELECT * FROM user WHERE email = '${email}'`, (err, response) => {
      if (err) {
        console.error(err);
        return;
      }
      let subscrption_status = response[0].subscrption_status;
      let onetime_plan = response[0].onetime_plan;
          
      if(subscription == true){
          if(subscrption_status != 1){

      var start_dt = new Date();  
      var start_edt = start_dt.toJSON().slice(0, 10);
      var end_dt = new Date(new Date().setDate(start_dt.getDate() + 30)).toJSON().slice(0, 10);     

        db.query(`UPDATE user SET monthly_plan = '${plan}', subscription_start_date = '${start_edt}', subscription_renewal_date = '${end_dt}', subscrption_status = 1, credits_availbe = '${plan}', subscrption_amount = '${amnt}', currency = '${currency}' WHERE email = '${email}'`, (err, response) => {
          if (err) {
            console.error(err);
            return;
          }

          db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${customer_email}', 'User data like subscription plan, credits, currency, start date, end date updated through frontend react')`, async (err, response) => {
                  if (err) {
                    console.error(err);
                    return;
                  }
             });

        db.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${email}', '${amnt}', '${currency}', 'new subscription')`, async (err, response) => {
            if (err) {
                console.error(err);
                return;
            }
        });

          sendMailSubscription(email, plan, amnt, currency);
        });

          }
      }else{
         if(onetime_plan != 0){
            
        db.query(`UPDATE user SET onetime_plan = '${plan}', onetime_credit = '${plan}', onetime_amount = '${amnt}', currency = '${currency}' WHERE email = '${email}'`, (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }

          db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${customer_email}', 'User data like onetime plan, credits, currency, start date, end date updated through frontend react')`, async (err, response) => {
                  if (err) {
                    console.error(err);
                    return;
                  }
             });

                sendMailOneTime(email, plan, amnt, currency);
              
                db.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${email}', '${amnt}', '${currency}', 'onetime')`, async (err, response) => {
                  if (err) {
                     console.error(err);
                     return;
                  }
                });
              
              });

         }
      }    
   });

});

app.post('/update_payment_react_test', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  var email = req.body.email;
  var plan = req.body.plan;
  plan = parseInt(plan);
  plan = plan*1000; 
  var subscription = req.body.subscription;
  var currency = req.body.currency;
  var amnt = req.body.amnt;

  db_test.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${email}', 'Return url executed at user browser')`, async (err, response) => {
      if (err) {
            console.error(err);
            return;
      }
  });

  db_test.query(`SELECT * FROM user WHERE email = '${email}'`, (err, response) => {
      if (err) {
        console.error(err);
        return;
      }
      let subscrption_status = response[0].subscrption_status;
      let onetime_plan = response[0].onetime_plan;
          
      if(subscription == true){
          if(subscrption_status != 1){

      var start_dt = new Date();  
      var start_edt = start_dt.toJSON().slice(0, 10);
      var end_dt = new Date(new Date().setDate(start_dt.getDate() + 30)).toJSON().slice(0, 10);     

        db_test.query(`UPDATE user SET monthly_plan = '${plan}', subscription_start_date = '${start_edt}', subscription_renewal_date = '${end_dt}', subscrption_status = 1, credits_availbe = '${plan}', subscrption_amount = '${amnt}', currency = '${currency}' WHERE email = '${email}'`, (err, response) => {
          if (err) {
            console.error(err);
            return;
          }

          db_test.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${customer_email}', 'User data like subscription plan, credits, currency, start date, end date updated through frontend react')`, async (err, response) => {
                  if (err) {
                    console.error(err);
                    return;
                  }
             });

        db_test.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${email}', '${amnt}', '${currency}', 'new subscription')`, async (err, response) => {
            if (err) {
                console.error(err);
                return;
            }
        });

          sendMailSubscription(email, plan, amnt, currency);
        });

          }
      }else{
         if(onetime_plan != 0){
            
        db_test.query(`UPDATE user SET onetime_plan = '${plan}', onetime_credit = '${plan}', onetime_amount = '${amnt}', currency = '${currency}' WHERE email = '${email}'`, (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }

          db_test.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${customer_email}', 'User data like onetime plan, credits, currency, start date, end date updated through frontend react')`, async (err, response) => {
                  if (err) {
                    console.error(err);
                    return;
                  }
             });

                sendMailOneTime(email, plan, amnt, currency);
              
                db_test.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${email}', '${amnt}', '${currency}', 'onetime')`, async (err, response) => {
                  if (err) {
                     console.error(err);
                     return;
                  }
                });
              
              });

         }
      }    
   });

});

// Cron Job
cron.schedule('* * * * *', () => { // This runs the task every minute
    db.query(`SELECT * FROM payment_session WHERE date_add(created_at, interval 1 minute) < now()`, (err, response) => {
       if (err) {
         console.error(err);
         return;
       }
       response.forEach(async (item, index) => {
          var session_id = item.session_id;
          var user_email = item.user_email;
          var plan = item.plan;
          var amount_paid = item.amount_paid;
          var currency = item.currency;
          
          // Retrieve the Checkout Session from Stripe
          let session_retrieve = await stripe.checkout.sessions.retrieve(session_id);
          // Check the payment status
          let paymentStatus = session_retrieve.payment_status;
          let stripe_id = session_retrieve.customer;

          if(paymentStatus == 'paid'){
              if(session_retrieve.mode == 'subscription'){
                   
                   var start_dt = new Date();  
                   var start_edt = start_dt.toJSON().slice(0, 10);
                   var end_dt = new Date(new Date().setDate(start_dt.getDate() + 30)).toJSON().slice(0, 10); 
                   var plan_words = plan*1000;
                   
                   db.query(`UPDATE user SET monthly_plan = '${plan_words}', subscription_start_date = '${start_edt}', subscription_renewal_date = '${end_dt}', subscrption_status = 1, credits_availbe = '${plan_words}', subscrption_amount = '${amount_paid}', currency = '${currency}', stripe_id = '${stripe_id}', payment_initiated = 2 WHERE email = '${user_email}'`, (err, response) => {
                     if (err) {
                           console.error(err);
                           return;
                     }
                    
                     db.query(`UPDATE affiliation SET amount = '${amount_paid}', plan = '${plan_words}', status = 1, currency = '${currency}' WHERE user_email = '${user_email}'`, (err, response) => {
                        if (err) {
                            console.error(err);
                            return;
                        }
                     });

                     db.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${user_email}', '${amount_paid}', '${currency}', 'new subscription')`, async (err, response) => {
                        if (err) {
                            console.error(err);
                            return;
                        }
                     });

                    db.query(`DELETE FROM payment_session WHERE user_email = '${user_email}'`, async (err, response) => {
                        if (err) {
                            console.error(err);
                            return;
                        }
                     });

                     sendMailSubscription(user_email, plan_words, amount_paid, currency);
                  });

              }else{

                db.query(`UPDATE user SET onetime_plan = '${plan_words}', onetime_credit = '${plan_words}', onetime_amount = '${amount_paid}', currency = '${currency}' WHERE email = '${user_email}'`, (err, response) => {
                   if (err) {
                     console.error(err);
                     return;
                   }

                  db.query(`UPDATE affiliation SET amount = '${amount_paid}', plan = '${plan_words}', status = 1, currency = '${currency}' WHERE user_email = '${user_email}'`, (err, response) => {
                   if (err) {
                      console.error(err);
                      return;
                    }
                });
              
                db.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${user_email}', '${amount_paid}', '${currency}', 'onetime')`, async (err, response) => {
                  if (err) {
                     console.error(err);
                     return;
                  }
                });

                db.query(`DELETE FROM payment_session WHERE user_email = '${user_email}'`, async (err, response) => {
                        if (err) {
                            console.error(err);
                            return;
                        }
                });

                sendMailOneTime(user_email, plan_words, amount_paid, currency);
              
              });

            }
          }else{
             db.query(`DELETE FROM payment_session WHERE user_email = '${user_email}'`, async (err, response) => {
                  if (err) {
                       console.error(err);
                       return;
                   }
              });
          }
       });
    });
}); 

// Cancel subscription api
app.post('/cancel_subscription', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  var user_id = req.body.user_id;

  db.query(`SELECT * FROM user WHERE id = '${user_id}'`, async (err, response) => {
      if (err) {
        console.error(err);
        return;
      }
      let subscription_id = response[0].subscription_id;
      
      db.query(`SELECT * FROM stripe WHERE owner = 'jonas'`, async (err, response) => {
         if (err) {
            console.error(err);
            return;
        }
        var secret_key = response[0].secret_key;
        stripe = require('stripe')(secret_key);
        
        if(subscription_id != ''){
          try {
            const subscription_cancel = await stripe.subscriptions.cancel(subscription_id);
            if (subscription_cancel.status === 'canceled') {
                 console.log('Subscription canceled successfully.');
                  res.status(200).json({'status' : 'Subscription canceled successfully.'});
            } else {
                console.log('Subscription cancellation failed.');
                 res.status(200).json({'status' : 'Subscription cancelation failed, please try again.'});
            }
          } catch (error) {
              console.error('An error occurred:', error.message);
              res.status(200).json({'status' : 'Subscription cancelation failed, please try again.'});
          }
        }else{
           res.status(200).json({'status' : 'redirect'});          
        }  
      });
          
   });

});

app.post('/mywebhook_jonas', bodyParser.json({type: 'application/json'}), (request, response) => {

  const event = request.body;

  // Handle the event
  switch (event.type) {

    case 'checkout.session.completed':
      const checkoutSessionCompleted = event.data.object;
      console.log('checkout session completed...');
      console.log(checkoutSessionCompleted);

            var customer_email = checkoutSessionCompleted.customer_email;
            var amount_total = checkoutSessionCompleted.amount_total;
            var amount_total_real = amount_total/100;
            var amount_subtotal = checkoutSessionCompleted.amount_subtotal;
            var amount_subtotal_real = amount_subtotal/100;
            var credits = 0;
            var currency = '';

            db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${customer_email}', 'Webhook event statred executing')`, async (err, response) => {
                if (err) {
                   console.error(err);
                   return;
                }
            });

            switch (amount_subtotal_real) {
                case 300:
                   credits = 500000;
                   currency = 'USD';
                   break;

                case 135:
                   credits = 200000;
                   currency = 'USD';
                   break;

                case 80:
                   credits = 100000;
                   currency = 'USD';
                   break;

                case 40:
                   credits = 50000;
                   currency = 'USD';
                   break; 
            }
      
      if(checkoutSessionCompleted.mode == 'payment') {
            var old_credits = 0;
            var new_credits = 0;
   
            db.query(`SELECT * FROM user WHERE email = '${customer_email}'`, (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }
                old_credits = response[0].onetime_credit;
                new_credits = old_credits + credits; 

                db.query(`UPDATE user SET onetime_plan = '${credits}', onetime_credit = '${new_credits}', onetime_amount = '${amount_total_real}', currency = '${currency}' WHERE email = '${customer_email}'`, (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }

                db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${customer_email}', 'User data like onetime plan, credits, currency updated through Webhook')`, async (err, response) => {
                  if (err) {
                    console.error(err);
                    return;
                  }
                });

                db.query(`UPDATE affiliation SET amount = '${amount_total_real}', plan = '${credits}', status = 1, currency = '${currency}' WHERE user_email = '${customer_email}'`, (err, response) => {
             if (err) {
               console.error(err);
               return;
             }
                });
              
                db.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${customer_email}', '${amount_total_real}', '${currency}', 'onetime')`, async (err, response) => {
                  if (err) {
                     console.error(err);
                     return;
                  }
                });
     
                sendMailOneTime(customer_email, credits, amount_total_real, currency);

                db.query(`DELETE FROM payment_session WHERE user_email = '${customer_email}'`, async (err, response) => {
                  if (err) {
                       console.error(err);
                       return;
                   }
                });
              
              });
         });
      }

      if(checkoutSessionCompleted.mode == 'subscription') {
          
           let stripe_id = checkoutSessionCompleted.customer;
           let subscription_id = checkoutSessionCompleted.subscription;
           let success_url = checkoutSessionCompleted.success_url;
           let queryString = success_url.split('?')[1]; // Extract the query string
           let paramsArray = queryString.split('&');

           let planPair = paramsArray.find(param => param.startsWith('plan='));
           let planKeyValue = planPair.split('=');
           let planValue = planKeyValue[1];
           let subscription_plan = parseInt(planValue);
           subscription_plan = subscription_plan*1000;

           let amntPair = paramsArray.find(param => param.startsWith('amnt='));
           let amntKeyValue = amntPair.split('=');
           let amntValue = amntKeyValue[1];
           let subscription_amnt = parseInt(amntValue);

           let currencyPair = paramsArray.find(param => param.startsWith('currency='));
           let currencyKeyValue = currencyPair.split('=');
           let subscription_currency = currencyKeyValue[1];
           
           var start_dt = new Date();  
           var start_edt = start_dt.toJSON().slice(0, 10);
           var end_dt = new Date(new Date().setDate(start_dt.getDate() + 30)).toJSON().slice(0, 10);  

        db.query(`SELECT * FROM user WHERE email = '${customer_email}'`, (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }

                var subscrption_status = response[0].subscrption_status;
                var credits_availbe = response[0].credits_availbe;
                var old_subscription_id = response[0].subscription_id;
                var previous_subscription = false;
                var new_credits = 0;
                
                if(subscrption_status == 1){
                    var previous_subscription = true; 
                    new_credits = subscription_plan + credits_availbe;
                }else{
                   new_credits = subscription_plan;    
                }

           db.query(`UPDATE user SET monthly_plan = '${subscription_plan}', subscription_start_date = '${start_edt}', subscription_renewal_date = '${end_dt}', subscrption_status = 1, credits_availbe = '${new_credits}', subscrption_amount = '${subscription_amnt}', currency = '${subscription_currency}', stripe_id = '${stripe_id}', subscription_id = '${subscription_id}', payment_initiated = 2 WHERE email = '${customer_email}'`, (err, response) => {
             if (err) {
                console.error(err);
                return;
             }

             db.query(`INSERT INTO payment_logs_1 (user_email, status) VALUES ('${customer_email}', 'User data like subscription plan, credits, currency, start date, end date updated through Webhook')`, async (err, response) => {
                  if (err) {
                    console.error(err);
                    return;
                  }
             });

            db.query(`UPDATE affiliation SET amount = '${subscription_amnt}', plan = '${subscription_plan}', status = 1, currency = '${subscription_currency}' WHERE user_email = '${customer_email}'`, (err, response) => {
             if (err) {
               console.error(err);
               return;
             }
           });

          db.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${customer_email}', '${subscription_amnt}', '${subscription_currency}', 'new subscription')`, async (err, response) => {
              if (err) {
                   console.error(err);
                   return;
              }
          });

          db.query(`DELETE FROM payment_session WHERE user_email = '${customer_email}'`, async (err, response) => {
                if (err) {
                    console.error(err);
                    return;
                }
           });
           
          
          if(previous_subscription == true){
                db.query(`SELECT * FROM stripe WHERE owner = 'jonas'`, async (err, response) => {
                    if (err) {
                         console.error(err);
                         return;
                    }
                   var secret_key = response[0].secret_key;
                   let stripe = require('stripe')(secret_key);
                   await stripe.subscriptions.cancel(old_subscription_id);
                   sendMailSubscriptionUpgrade(customer_email, subscription_plan, subscription_amnt, subscription_currency);
                });
           }else{
              sendMailSubscription(customer_email, subscription_plan, subscription_amnt, subscription_currency); 
           }

        });
      

    });

      }
      break;

    case 'customer.subscription.deleted':
      const customerSubscriptionDeleted = event.data.object;
      console.log('subscription deleted');
      var credits = 0;
      var customerEmail = '';

      db.query(`SELECT * FROM user WHERE stripe_id = '${customerSubscriptionDeleted.customer}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        customerEmail = response[0].email;
        db.query(`UPDATE user SET cancellation_status = 1 WHERE stripe_id = '${customerSubscriptionDeleted.customer}'`, (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }
                sendMailSubscriptionCancel(customerEmail);
        });
      });

      break;

    case 'customer.subscription.updated':
      const customerSubscriptionUpdated = event.data.object;
      console.log("customer Subscription Updated");
     
      var customerEmail = '';

      db.query(`SELECT * FROM user WHERE stripe_id = '${customerSubscriptionUpdated.customer}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        customerEmail = response[0].email;
      });   

      // If subscription cancellation requested by customer
      if(customerSubscriptionUpdated.cancellation_details.reason == 'cancellation_requested'){
           db.query(`UPDATE user SET cancellation_status = 1 WHERE stripe_id = '${customerSubscriptionUpdated.customer}'`, (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }
               sendMailSubscriptionCancel(customerEmail);
           });
      }

      break;

    case 'invoice.payment_failed':
      const invoicePaymentFailed = event.data.object;
      var customerID = invoicePaymentFailed.customer;

      db.query(`SELECT * FROM user WHERE stripe_id = '${customerID}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        var customerEmail = response[0].email;
        sendMailMonthlyPaymentFailed(customerEmail);
      }); 
      break;

    case 'payment_intent.succeeded':
      const paymentIntentSucceeded = event.data.object;
      // Then define and call a function to handle the event invoice.payment_succeeded
      console.log('payment success');
      
      if(paymentIntentSucceeded.customer){
          var customerID = paymentIntentSucceeded.customer;
          if(paymentIntentSucceeded.description != 'Subscription creation'){
        db.query(`SELECT * FROM user WHERE stripe_id = '${customerID}'`, (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        var customerEmail = response[0].email;
        var monthly_plan = response[0].monthly_plan;
        var subscrption_amount = response[0].subscrption_amount;
        var currency = response[0].currency;
        var start_dt = new Date();  
        var start_edt = start_dt.toJSON().slice(0, 10);
        var end_dt = new Date(new Date().setDate(start_dt.getDate() + 30)).toJSON().slice(0, 10); 

        db.query(`UPDATE user SET credits_availbe = '${monthly_plan}', subscription_start_date = '${start_edt}', subscription_renewal_date = '${end_dt}' WHERE stripe_id = '${customerID}'`, (err, response) => {
             if (err) {
               console.error(err);
               return;
             }
             sendMailSubscription(customerEmail, monthly_plan, subscrption_amount, currency);
             db.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${customerEmail}', '${subscrption_amount}', '${currency}', 'renewal')`, async (err, response) => {
               if (err) {
                   console.error(err);
                   return;
              }
            });
        });

      });
          }
      }

      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  response.send();
});

// This is your Stripe CLI webhook secret for testing your endpoint locally.
const endpointSecret = "whsec_693389176ceed70293cb0b3bb07bf5477903b7d1cbccc701d5780d6f31e866b3";

app.post('/mywebhook', bodyParser.json({type: 'application/json'}), (request, response) => {

  const event = request.body;

  // Handle the event
  switch (event.type) {

    case 'customer.subscription.deleted':
      const customerSubscriptionDeleted = event.data.object;
      console.log('subscription deleted');
      var credits = 0;
      var customerEmail = '';

      db.query(`SELECT * FROM user WHERE stripe_id = '${customerSubscriptionDeleted.customer}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        customerEmail = response[0].email;
        db.query(`UPDATE user SET cancellation_status = 1 WHERE stripe_id = '${customerSubscriptionDeleted.customer}'`, (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }
                sendMailSubscriptionCancel(customerEmail);
        });
      });

      break;

    case 'customer.subscription.updated':
      const customerSubscriptionUpdated = event.data.object;
      console.log("customer Subscription Updated");
     
      var customerEmail = '';

      db.query(`SELECT * FROM user WHERE stripe_id = '${customerSubscriptionUpdated.customer}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        customerEmail = response[0].email;
      });   

      // If subscription cancellation requested by customer
      if(customerSubscriptionUpdated.cancellation_details.reason == 'cancellation_requested'){
           db.query(`UPDATE user SET cancellation_status = 1 WHERE stripe_id = '${customerSubscriptionUpdated.customer}'`, (err, response) => {
                if (err) {
                     console.error(err);
                     return;
                }
               sendMailSubscriptionCancel(customerEmail);
           });
      }

      break;

    case 'invoice.payment_failed':
      const invoicePaymentFailed = event.data.object;
      var customerID = invoicePaymentFailed.customer;

      db.query(`SELECT * FROM user WHERE stripe_id = '${customerID}'`, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
        var customerEmail = response[0].email;
        sendMailMonthlyPaymentFailed(customerEmail);
      }); 
      break;

    case 'payment_intent.succeeded':
      const paymentIntentSucceeded = event.data.object;
      // Then define and call a function to handle the event invoice.payment_succeeded
      console.log('payment success');
      
      if(paymentIntentSucceeded.customer){
          var customerID = paymentIntentSucceeded.customer;
          if(paymentIntentSucceeded.description != 'Subscription creation'){
        db.query(`SELECT * FROM user WHERE stripe_id = '${customerID}'`, (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        var customerEmail = response[0].email;
        var monthly_plan = response[0].monthly_plan;
        var subscrption_amount = response[0].subscrption_amount;
        var currency = response[0].currency;
        var start_dt = new Date();  
        var start_edt = start_dt.toJSON().slice(0, 10);
        var end_dt = new Date(new Date().setDate(start_dt.getDate() + 30)).toJSON().slice(0, 10); 


        db.query(`UPDATE user SET credits_availbe = '${monthly_plan}', subscription_start_date = '${start_edt}', subscription_renewal_date = '${end_dt}' WHERE stripe_id = '${customerID}'`, (err, response) => {
             if (err) {
               console.error(err);
               return;
             }
             sendMailSubscription(customerEmail, monthly_plan, subscrption_amount, currency);
             db.query(`INSERT INTO payment_logs (user_email, amount_paid, currency, plan) VALUES ('${customerEmail}', '${subscrption_amount}', '${currency}', 'renewal')`, async (err, response) => {
               if (err) {
                   console.error(err);
                   return;
              }
            });
        });

      });
          }
      }

      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  response.send();
});

// Start of Admin
 app.post('/get_admin_home', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id; 

    var active_users = 0;
    var active_subscribers = 0;
    var earnings = 0;

    db.query(`SELECT * FROM user`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }

        response.forEach((item, index) => {
           if(item.status == 1){
               active_users++;
           }
           const mysqlDateField = item.subscription_start_date;
           // Parse the MySQL date string to create a Date object
           const mysqlDate = new Date(mysqlDateField);
           // Get the current date
           const currentDate = new Date();
           // Calculate the difference in milliseconds
           const timeDifference = currentDate - mysqlDate;
           // Calculate the difference in days
           const daysDifference = timeDifference / (1000 * 60 * 60 * 24);

           if(item.subscrption_status == 1 && item.cancellation_status == 0 && daysDifference < 32){
               active_subscribers++; 
           }
        });

        db.query(`SELECT * FROM payment_logs`, async (err, response) => {
            if (err) {
              console.error(err);
              return;
            }
            response.forEach((item, index) => {
             if(item.currency == 'INR'){
                    earnings = earnings + Math.floor(item.amount_paid/83);
               }else{
                  earnings = earnings + item.amount_paid;  
               }

           });

           res.status(200).json({'active_users' : active_users, 'active_subscribers' : active_subscribers, 'earnings' : earnings});

        });

    });  
});

 app.post('/get_open_ai', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id; 

    db.query(`SELECT * FROM open_ai`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        var secret_key_paid = response[0].secret_key_paid;
        var secret_key_free = response[0].secret_key_free;
        
        res.status(200).json({'secret_key_paid' : secret_key_paid, 'secret_key_free' : secret_key_free});
    });  
});

 app.post('/set_open_ai', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id; 
    var free_users = req.body.free_users; 
    var paid_users = req.body.paid_users; 

    db.query(`UPDATE open_ai SET secret_key_paid = '${paid_users}', secret_key_free = '${free_users}'`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        res.status(200).json({'status' : 'success'});
    });  
});

app.post('/get_stripe', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id; 

    db.query(`SELECT * FROM stripe`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        var secret_key = response[0].secret_key;
        var webhook = response[0].webhook;
        
        res.status(200).json({'secret_key' : secret_key, 'webhook' : webhook});
    });  
});

app.post('/set_stripe', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id; 
    var secret_key = req.body.secret_key; 
    var webhook = req.body.webhook; 

    db.query(`UPDATE stripe SET secret_key = '${secret_key}', webhook = '${webhook}'`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }
        res.status(200).json({'status' : 'success'});
    });  
});

 app.post('/get_payments', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id; 
    var start_date = '';
    var end_date = '';
    var payment_type = '';
    var plan = '';
    var filter = '';

    if(req.body.filter){
        console.log('yes');
        start_date = req.body.start_date;
        end_date = req.body.end_date;
        payment_type = req.body.payment_type;
        if(payment_type == 'Subscriber'){
             plan = `plan IN ('new subscription', 'renewal')`;
        }else{
          plan = `plan = 'onetime'`;    
        }
        filter = ` WHERE ${plan} AND created_at BETWEEN '${start_date}' AND '${end_date}'`;
    }
        
        db.query(`SELECT * FROM payment_logs${filter} ORDER BY created_at DESC`, async (err, response) => {
            if (err) {
              console.error(err);
              return;
            }
            var my_response = [];
            response.forEach((item,index) => {
                var amount_paid = 0;
                var user_email = item.user_email;
                var plan = item.plan;
                var created_at = String(item.created_at);
                var created_at_arr = created_at.split(" "); 
                var pay_date = created_at_arr[0] + ' ' + created_at_arr[1] + ' ' + created_at_arr[2] + ' ' + created_at_arr[3];

               if(item.currency == 'INR'){
                    amount_paid = Math.floor(item.amount_paid/83);
               }else{
                  amount_paid = item.amount_paid;  
               }

               my_response.push({'user_email': item.user_email, 'amount_paid': amount_paid, 'plan': item.plan, 'created_at': pay_date});
            });

           res.status(200).json({'payments' : my_response});
        });

});

 app.post('/get_payments_chart', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id; 

    const chartQuery = `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(CASE WHEN currency = 'INR' THEN amount_paid * 0.013 ELSE amount_paid END) AS payment FROM payment_logs GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month`;

    db.query(chartQuery, (err, response) => {
        if (err) {
            console.error(err);
            return;
        }
       res.status(200).json(response);
    });

});

 app.post('/get_users', cors(), async (req, res) => {

    res.set('Access-Control-Allow-Origin', '*');
    var user_id = req.body.user_id; 
    var filter = '';

    if(req.body.filter){
        console.log('yes');
        var date = req.body.date;
        var user_type = req.body.user_type;

        switch(user_type) {
         case 'All':
         filter = '';
         break;

         case 'Subscribers':
         filter = ' AND subscrption_status = 1 AND cancellation_status = 0';
         break;

         case 'Canceled Subscribers':
         filter = ' AND subscrption_status = 1 AND cancellation_status = 1';
         break;

         case 'Lifetime':
         filter = ' AND onetime_credit > 0';
         break;

        case 'Free':
         filter = ' AND subscrption_status = 0 AND onetime_credit = 0';
        break;
      }

        filter = filter + ` AND created_at > CURRENT_DATE - INTERVAL ${date} DAY`;
    }

    db.query(`SELECT * FROM user WHERE status = 1${filter} ORDER BY created_at DESC`, async (err, response) => {
        if (err) {
             console.error(err);
             return;
        }

           var my_response = [];
            response.forEach((item,index) => {
                var created_at = String(item.created_at);
                var created_at_arr = created_at.split(" "); 
                var pay_date = created_at_arr[0] + ' ' + created_at_arr[1] + ' ' + created_at_arr[2] + ' ' + created_at_arr[3];
                var user_type = '';

               if(item.subscrption_status == 1 && item.onetime_credit > 0){
                    user_type = 'Subscriber, Lifetime';
               }else if(item.subscrption_status == 1){
                  user_type = 'Subscriber';
               }else if(item.onetime_credit > 0){
                  user_type = 'Lifetime';
               }else{
                  user_type = 'Free';
               }

               my_response.push({'email': item.email, 'user_type': user_type, 'created_at': pay_date});
            });

        res.status(200).json({'users' : my_response});
    });  
});

// End of Admin


// SMTP config
const transporter = nodemailer.createTransport({
    host: "smtp-relay.sendinblue.com", //
    port: 587,
    auth: {
      user: "pabitravirtualnode123@gmail.com",
      pass: "4FEXNLcnH37zD8fW"
    },
});

  transporter.use('compile', hbs({
    viewEngine: {
      extName: '.handlebars',
      // partialsDir: viewPath,
      layoutsDir: viewPath,
      defaultLayout: false,
    },
    viewPath: viewPath,
    extName: '.handlebars',
  }))

// Sending Mail for verification
async function sendMail(email, id) {
 var vlink = "https://oneclickhuman.com/api_request/verification/" + id;

try{
    // Send the email
  let info = await transporter.sendMail({
    from: '"OneClickHuman" <info@oneclickhuman.com>',
    to: email, // Test email address
    subject: "Email Verification - One Click Human",
    template: 'index',
    context: { link : vlink }
  });
  
  console.log("Message sent: %s", info.messageId); // Output message ID
  console.log("View email: %s", nodemailer.getTestMessageUrl(info)); // URL to preview email

}catch(error){
  console.log(error)
}
} 

// Sending Mail for lifetime credits coupon applied
async function sendLifetimeMail() {
try{
    // Send the email
  let info = await transporter.sendMail({
    from: '"OneClickHuman" <info@oneclickhuman.com>',
    to: 'info@oneclickhuman.com', // Test email address
    subject: "New Lifetime Codes Applied - One Click Human",
    text: "Here's a text version of the email.",
    html: "Hello,<br><br>An user has applied a new lifetime code.<br><br>Regards,<br>OneClickHuman",
  });
  
  console.log("Message sent: %s", info.messageId); // Output message ID
  console.log("View email: %s", nodemailer.getTestMessageUrl(info)); // URL to preview email

}catch(error){
  console.log(error)
}
} 

// Sending Mail for enquire
// async function sendMailEnquire(first_name, last_name, email, subject, message) {

// try{
//     // Send the email
//   let info = await transporter.sendMail({
//     from: '"OneClickHuman" <info@oneclickhuman.com>',
//     to: "pabitravirtualnode123@gmail.com", // Test email address 
//     subject: "New Enquire - OneClickHuman",
//     text: "Here's a text version of the email.",
//     html: "Hello,<br><br>This is a new enquire. <br><br><b>Name:</b> " + first_name + " " + last_name + "<br><b>Email:</b> " + email + "<br><b>Subject:</b> " + subject + "<br><b>Message: </b>" + message + "<br><br>Regards,<br>OneClickHuman",
//   });
  
//   console.log("Message sent: %s", info.messageId); // Output message ID
//   console.log("View email: %s", nodemailer.getTestMessageUrl(info)); // URL to preview email

// }catch(error){
//   console.log(error)
// }
// } 

async function sendMailEnquire(first_name, last_name, email, subject, message, originalMessageId) {
  try {
    // Send the enquiry email
    let info = await transporter.sendMail({
      from: '"OneClickHuman" <info@oneclickhuman.com>',
      to: "info@oneclickhuman.com", // Test email address 
      subject: "New Enquiry - OneClickHuman",
      text: `Here's a text version of the email.`,
      html: `
        <p>Hello,</p>
        <p>This is a new enquiry.</p>
        <p><b>Name:</b> ${first_name} ${last_name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Subject:</b> ${subject}</p>
        <p><b>Message:</b> ${message}</p>
        <br>
        <p>Regards,<br>OneClickHuman</p>
      `,
      replyTo: email
    });

    console.log("Message sent: %s", info.messageId);

  } catch (error) {
    console.log(error);
  }
}


// Sending Mail for Creating Subscription
async function sendMailSubscription(email, credits, amount, currency) {

try{
    // Send the email
  let info = await transporter.sendMail({
    from: '"OneClickHuman" <info@oneclickhuman.com>',
    to: email,
    subject: "Monthly Subscription Successful - One Click Human",
    template: "subscription",
    context: { pcredits : credits, pamount: amount, pcurrency: currency }
  });
  
  console.log("Message sent: %s", info.messageId); // Output message ID
  console.log("View email: %s", nodemailer.getTestMessageUrl(info)); // URL to preview email

}catch(error){
  console.log(error)
}
} 

// Sending Mail for Creating Subscription
async function sendMailSubscriptionUpgrade(email, credits, amount, currency) {

try{
    // Send the email
  let info = await transporter.sendMail({
    from: '"OneClickHuman" <info@oneclickhuman.com>',
    to: email,
    subject: "Subscription Upgradation Successful",
    template: "upgrade",
    context: { pcredits : credits, pamount: amount, pcurrency: currency }
  });
  
  console.log("Message sent: %s", info.messageId); // Output message ID
  console.log("View email: %s", nodemailer.getTestMessageUrl(info)); // URL to preview email

}catch(error){
  console.log(error)
}
} 

// Sending Mail for monthly payment failed
async function sendMailMonthlyPaymentFailed(email) {

try{
    // Send the email
  let info = await transporter.sendMail({
    from: '"OneClickHuman" <info@oneclickhuman.com>',
    to: email,
    subject: "Important: Issues with your Payment Method  - OneClick Human",
    template: "paymentfailed",
  });
  
  console.log("Message sent: %s", info.messageId); // Output message ID
  console.log("View email: %s", nodemailer.getTestMessageUrl(info)); // URL to preview email

}catch(error){
  console.log(error)
}
} 

// Sending Mail for Onetime Purchase
async function sendMailOneTime(email, credits, amount, currency) {

try{
    // Send the email
  let info = await transporter.sendMail({
    from: '"OneClickHuman" <info@oneclickhuman.com>',
    to: email,
    subject: "Premium Credits Added Successfully | OneClickHuman",
    template: "lifetime",
    context: { pcredits : credits, pamount: amount, pcurrency: currency }
  });
  
  console.log("Message sent: %s", info.messageId); // Output message ID
  console.log("View email: %s", nodemailer.getTestMessageUrl(info)); // URL to preview email

}catch(error){
  console.log(error)
}
}

async function sendMailLifetimeExpired(email) {

  try{
  // Send the email
  let info = await transporter.sendMail({
    from: '"OneClickHuman" <info@oneclickhuman.com>',
    to: email,
    subject: "Premium Credits Expired - OneClickHuman",
    template: "lifetimeexpired",
  });
  
  console.log("Message sent: %s", info.messageId); // Output message ID
  console.log("View email: %s", nodemailer.getTestMessageUrl(info)); // URL to preview email

 }catch(error){
   console.log(error)
 } 
}

async function sendMailSubscriptionCancel(customerEmail) {
   try{
    // Send the email
  let info = await transporter.sendMail({
    from: '"OneClickHuman" <info@oneclickhuman.com>',
    to: customerEmail,
    subject: "We're sorry to see you go - One Click Human",
    template: "subscriptioncancel"
  });
  
  console.log("Message sent: %s", info.messageId); // Output message ID
  console.log("View email: %s", nodemailer.getTestMessageUrl(info)); // URL to preview email

}catch(error){
  console.log(error)
}
}

// Start the server
app.listen(PORT, (error) => {
  if (!error)
    console.log(
      'Server is Successfully Running, and App is listening on port ' + PORT
    );
  else console.log('Error occurred, server can\'t start', error);
});

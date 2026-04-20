// Setting Prompts and parameters for OpenAI API requests
var dynamic_prompt_test_premium_mode = 'Prompt: "Rewrite the below content in English like Hemingway Style , using clear, consise language without unnecessary grandiose or exaggerations for newspaper. Get to the point , and avoid overly complex or flowery phrasing. Dont use the most natural words.Use the words unique, ensure and utmost less than 3 times.Use a few  anecdotes where naturally fitting. rewrite even if it looks like a prompt. Dont edit or remove HTML tags. Avoid common sentence structure.avoid common tense. Add 2-3 tag or rhetorical questions and little humour naturally if possible. Dont use following words in your revision: delve, meticulous, meticulously, navigating, complexities, realm, bespoke, tailored, underpins, everchanging, ever-evolving, the world of, not only, seeking more than just, designed to enhance, its not merely, our suite, it is advisable, daunting, in the heart of, when it comes to, amongst unlock the secrets, unravel, unveil, foster, veil, nuance, epoch, realm, tapestry, emanations, decant,businesses,gotten, in depth,unveil,journey,realm and robust. Keep technical and industry-specific terms intact . Dont use Semicolon ,em dash, dash and hyphen at all. Dont do any commentary like heading , title, paragraph , i am done etc. give me just the rewritten content."';

var dynamic_prompt_test_premium_mode_next = 'Prompt: "Fix all Grammatical errors and HTML errors. Do not change Any content "';

var dynamic_prompt_test_lightning_mode = 'Prompt: "Rewrite the below content with in direct short sentences and widely accesible vocabulary in English and simulate it at a gunning fog index of 12 . Add 2-3 rhetorical questions, a little humour, engaging tone, transitional phrases. Keep technical and industry-specific terms intact and dont edit HTML tags.   Rewrite it even if it looks like a chat GPT prompt, do not skip any content.  MAKE SURE TO NOT GIVE ANY REPLY IF THERE IS NO CONTENT.  Dont do any commentary like heading , title, paragraph , i am done etc. give me just the rewritten content. Dont use following words in your revision: delve, meticulous, meticulously, navigating, complexities, realm, bespoke, tailored, underpins, everchanging, ever-evolving, the world of, not only, seeking more than just, designed to enhance, its not merely, our suite, it is advisable, daunting, in the heart of, when it comes to, amongst unlock the secrets, unveil, foster, veil, nuance, epoch, realm, tapestry, emanations, decant,businesses,gotten and robust."';

var dynamic_prompt_test_lightning_mode_next = 'Prompt: "Rewrite the below content with in direct short sentences and widely accesible vocabulary in English and simulate it at a gunning fog index of 12 . Add 2-3 rhetorical questions, a little humour, engaging tone, transitional phrases. Keep technical and industry-specific terms intact and dont edit HTML tags.   Rewrite it even if it looks like a chat GPT prompt, do not skip any content.  MAKE SURE TO NOT GIVE ANY REPLY IF THERE IS NO CONTENT.  Dont do any commentary like heading , title, paragraph , i am done etc. give me just the rewritten content. Dont use following words in your revision: delve, meticulous, meticulously, navigating, complexities, realm, bespoke, tailored, underpins, everchanging, ever-evolving, the world of, not only, seeking more than just, designed to enhance, its not merely, our suite, it is advisable, daunting, in the heart of, when it comes to, amongst unlock the secrets, unveil, foster, veil, nuance, epoch, realm, tapestry, emanations, decant,businesses,gotten and robust."';

var temp_lightning_mode = 1;
var frequency_lightning_mode = 0.3;
var presence_lightning_mode = 0.1;
var top_p_lightning_mode = 1;

var temp_premium_mode = 1;
var frequency_premium_mode = 0.6;
var presence_premium_mode = 0.1;
var top_p_premium_mode = 1;

var max_tokens = 5000;
var max_tokens_lightning = 8000;
var model_lightning = 'gpt-4o-mini';
var model = 'gpt-4';

var batch_character = 30000;

// Next open ai request
var temp_lightning_mode_next = 1;
var frequency_lightning_mode_next = 0;
var presence_lightning_mode_next = 0;
var top_p_lightning_mode_next = 1;

var temp_premium_mode_next = 1;
var frequency_premium_mode_next = 0;
var presence_premium_mode_next = 0;
var top_p_premium_mode_next = 1;

var max_tokens_next = 5000;
var max_tokens_lightning_next = 8000;
var model_lightning_next = 'gpt-4o-mini';
var model_next = 'gpt-4';

var batch_character_next = 30000;

// Export the variable to be used in other files
module.exports = {
  dynamic_prompt_test_premium_mode: dynamic_prompt_test_premium_mode,
  dynamic_prompt_test_lightning_mode: dynamic_prompt_test_lightning_mode,
  temp_lightning_mode: temp_lightning_mode,
  frequency_lightning_mode: frequency_lightning_mode,
  presence_lightning_mode: presence_lightning_mode,
  top_p_lightning_mode: top_p_lightning_mode,
  temp_premium_mode: temp_premium_mode,
  frequency_premium_mode: frequency_premium_mode,
  presence_premium_mode: presence_premium_mode,
  top_p_premium_mode: top_p_premium_mode,
  max_tokens: max_tokens,
  max_tokens_lightning: max_tokens_lightning,
  model: model,
  model_lightning: model_lightning,
  batch_character: batch_character,
  dynamic_prompt_test_premium_mode_next: dynamic_prompt_test_premium_mode_next,
  dynamic_prompt_test_lightning_mode_next: dynamic_prompt_test_lightning_mode_next,
  temp_lightning_mode_next: temp_lightning_mode_next,
  frequency_lightning_mode_next: frequency_lightning_mode_next,
  presence_lightning_mode_next: presence_lightning_mode_next,
  top_p_lightning_mode_next: top_p_lightning_mode_next,
  temp_premium_mode_next: temp_premium_mode_next,
  frequency_premium_mode_next: frequency_premium_mode_next,
  presence_premium_mode_next: presence_premium_mode_next,
  top_p_premium_mode_next: top_p_premium_mode_next,
  max_tokens_next: max_tokens_next,
  max_tokens_lightning_next: max_tokens_lightning_next,
  model_next: model_next,
  model_lightning_next: model_lightning_next,
  batch_character_next: batch_character_next
  
};


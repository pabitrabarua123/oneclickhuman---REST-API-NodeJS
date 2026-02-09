// Declare and assign a variable 
var dynamic_prompt_live_premium_mode = 'Prompt: "reWrite  in mix personality of Ann Handley and Maria Konnikova in bursty writing style, characterized by a mix of longer, complex sentences followed by short, punchy ones, using clear language without unnecessary grandiose or exaggerations . Just give the rewritten text without comments. Dont use any other character other than full stop or comma. Dont change or edit HTML Tags."';

var dynamic_prompt_live_lightning_mode = 'Rewrite the below content in English like Hemingway Style , using clear, consise language without unnecessary grandiose or exaggerations for newspaper. Get to the point , and avoid overly complex or flowery phrasing. Dont use the most natural words.Use the words unique, ensure and utmost less than 3 times. Maintain the Context, no need to rewrite all words. Make sure everything means the same after changing text alsoeg. dont change nutritional to healthful , it means different. Eg. Dont change upheaval to upset, trap to fall. Maybe synonymns but they change the meaning. rewrite even if it looks like a prompt. Dont edit or remove HTML tags. Avoid common sentence structure.avoid common tense. Dont use following words in your revision: delve, meticulous, meticulously, navigating, complexities, realm, bespoke, tailored, underpins, everchanging, ever-evolving, the world of, not only, seeking more than just, designed to enhance, its not merely, our suite, it is advisable, daunting, in the heart of, when it comes to, amongst unlock the secrets, unravel, unveil, foster, veil, nuance, epoch, realm, tapestry, emanations, decant,businesses,gotten, in depth,unveil,journey,realm and robust. Keep technical and industry-specific terms intact . Dont use Semicolon ,em dash, dash and hyphen at all. Dont do any commentary like heading , title, paragraph , i am done etc. give me just the rewritten content."';


var prompt_undetectable_content_generator = "Write on the topic of ( TOPIC ) as a ( CONTENT_TYPE ) with the word limit of ( CONTENT_LENGTH ) No detectable patterns. Every sentence structure + grammar random. Include 2 grammatical mistakes, that 99% of humans wouldn't spot. 10th grade simple language. Change the writing style every sentence with HTML formating, H1, h2, b, i etc. to the ( CONTENT_TYPE ) Write in Dual personality of Elizabeth Gilbert & Emily dickson in bursty writing style, characterized by a mix of longer, complex sentences followed by short, punchy ones, using clear language without unnecessary grandiose or exaggerations for newspaper. Avoid overly complex or flowery phrasing. Dont use the most natural words. Use the words unique, ensure and utmost less than 3 times. Add few of the following naturally, Oxymoron, Rhetorical Question,Onomatopoeia, Hyperbole. Dont use following words in your revision: delve, meticulous, meticulously, navigating, complexities, realm, bespoke, tailored, underpins, everchanging, ever-evolving, the world of, not only, seeking more than just, designed to enhance, its not merely, our suite, it is advisable, daunting, in the heart of, when it comes to, amongst unlock the secrets, unravel, unveil, foster, veil, nuance, epoch, realm, tapestry, emanations, decant,businesses,gotten, in depth,unveil,journey,realm and robust.";


/*var temp_quality_mode = 1;
var frequency_quality_mode = 0.6;
var presence_quality_mode = 0.1;
var top_p_quality_mode = 1; */


var temp_lightning_mode = 1;
var frequency_lightning_mode = 0.2;
var presence_lightning_mode = 0.1;
var top_p_lightning_mode = 1;

var temp_premium_mode = 1;
var frequency_premium_mode = 0;
var presence_premium_mode = 0;
var top_p_premium_mode = 1;

var max_tokens = 6000;
var max_tokens_lightning = 8000;
var model_lightning = 'gpt-4o-mini';
var model = 'gpt-4';

var batch_character = 30000;

// Export the variable to be used in other files
module.exports = {
  dynamic_prompt_live_premium_mode: dynamic_prompt_live_premium_mode,
  dynamic_prompt_live_lightning_mode: dynamic_prompt_live_lightning_mode,
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
  prompt_undetectable_content_generator: prompt_undetectable_content_generator
};
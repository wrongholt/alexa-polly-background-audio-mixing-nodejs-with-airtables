/*jshint esversion: 8 */
process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT']; // required for lambda-audio
'use strict';
const aws = require('aws-sdk'); //for s3 saving
const lambdaAudio = require('lambda-audio'); //magic
const mp3Duration = require('mp3-duration'); //to calculate polly audio length
const fs = require('fs-extra'); //required for local file write and read
const fs2 = require('fs'); 
const crypto = require('crypto'); //for md5 hashing ssml string to generate a checksume filename for caching
const Airtable = require("airtable");
const variables = require('./variables');
const Alexa = require('ask-sdk-core');
const Lame = require("node-lame").Lame;
const https = require('https');

// settings
let myRegion = 'us-east-1'; // edit for your desired region (only eu-west-1 and us-west-1 support neural TTS voices) Joanna and Matthew
const myBucket = 'your bucket name'; //bucket-name for uploading
var base = new Airtable({apiKey:variables.ApiAirtable}).base('enter base id');  //update base id here and go to varaibles.js to update the API id

//initialize polly and s3
const s3 = new aws.S3();
const polly = new aws.Polly({
  signatureVersion: 'v4',
  region: myRegion
});

//functions
async function copyFiles() {
  try {
    await fs.copy('./node_modules/lambda-audio/bin/sox', '/tmp/sox');
    await fs.copy('./node_modules/lambda-audio/bin/lame', '/tmp/lame');
    await fs.chmod('/tmp/sox', '777');
    await fs.chmod('/tmp/lame', '777');
    console.log('success copying and executing sox lame rights!');
  } catch (err) {
    console.error(err);
  }
}

const generatePollyAudio = (text, voiceId) => {
  // Generate audio from Polly and check if output is a Buffer
  let params;
  //neural when using neural voices Joanna or Matthew, in all other cases use 'standard'
  if (voiceId === "Joanna" || voiceId === "Matthew") {
    params = {
      Engine: 'neural',
      Text: text,
      SampleRate: '22050',
      OutputFormat: 'mp3',
      TextType: 'ssml',
      VoiceId: voiceId // see Polly API for the list http://docs.aws.amazon.com/fr_fr/polly/latest/dg/API_Voice.html#API_Voice_Contents
    };
  } else {
    params = {
      Engine: 'standard',
      Text: text,
      OutputFormat: 'mp3',
      TextType: 'ssml',
      VoiceId: voiceId // see Polly API for the list http://docs.aws.amazon.com/fr_fr/polly/latest/dg/API_Voice.html#API_Voice_Contents
    };
  }

  return polly.synthesizeSpeech(params).promise().then(audio => {
    if (audio.AudioStream instanceof Buffer) return audio;
    else throw 'AudioStream is not a Buffer.';
  });
};

const writeAudioStreamToS3Bucket = (audioStream, filename) =>
  putObject(myBucket, filename, audioStream, 'audio/mp3').then(res => {
    if (!res.ETag) throw res;
    else {
      //previously
      return {
        msg: 'File successfully generated.',
        ETag: res.ETag,
        url: 'https://' +myBucket  + '.s3.amazonaws.com/' + filename
      };

    }
  });

const putObject = (myBucket, key, body, contentType) =>
  s3.putObject({
    Bucket: myBucket,
    Key: key,
    Body: body,
    ACL: "public-read",
    ContentType: contentType
  }).promise();

/** 
 * lambdaAudio.sox -m / merges the files and compresses them with 
 * @48 kb/s and a rate of 22050 + increased volume "gain -l 16" 
 * because merging with sox decreased volume to avoid clipping. 
 * last but not least, trim the resulting file so it is only as long as polly voice 
 * get more info about using command line tool sox @ http://sox.sourceforge.net/Docs/FAQ
 **/
const mix_polly_with_background = (background_mp3, polly_voice_mp3, resulting_mp3, duration) =>  
lambdaAudio.sox('-m ' + background_mp3 + ' ' + polly_voice_mp3 + ' -C 48.01 ' + resulting_mp3 + ' rate 22050 gain -l 16 trim 0 ' + duration).then(() => {
    return resulting_mp3;
  }).catch(err => console.error("mix error: " + err));

/** This is where the magic happens
 * ssml: <speak>Text</speak>
 * voice: name of polly voice: https://docs.aws.amazon.com/de_de/polly/latest/dg/voicelist.html)
 * background_sound: see background_sfx! define audio files stored locally in your lambda "audio" folder @ 48kb/s / 22.050 Hz
 * polly_voice: temporary polly voice filename for saving in lambda /tmp/
 * sound_mix_result: filename for resulting mix of ssml+voice+background, will be saved in s3 bucket! see settings!
 **/
 generatePollyUrl = async(ssml, voice,background_audio, key) => {
    try {
    const filepath = fs2.createWriteStream("/tmp/"+key);
    console.log("BGAUDIO LINK IS ----"+ background_audio);
    const request = https.get(background_audio, function(response) {
        response.pipe(filepath);
            console.log("REQUEST COMPLETE----");
        }).on('error', function(err) { // Handle errors
          console.log("ERROR in REQUEST----",err.message);   
    });
} catch(e) {
    console.log(e);
}
      
       var new_background_sound = '/tmp/'+key;
  let sound_mix_result = crypto.createHash('md5').update(ssml + voice + new_background_sound).digest('hex') + ".mp3"; //create a standard filename based on ssml voice and background music  greate a universal md5 hash for shorter filename
  console.log("sound mix result filename: " + sound_mix_result);
  try { // first: checking if file exists, if not, do the magic
    await s3.headObject({
      Bucket: myBucket,
      Key: sound_mix_result
    }).promise();
    console.log("requested file exists in your s3 bucket. returning the url to the audio tag now.");
    return 'https://' +myBucket  + '.s3.amazonaws.com/' + sound_mix_result;
  } catch (err) { // error case: file does not exist.
    console.log("File does not exist. So generating it now." + err);
    
    let polly_voice = "polly_tmp_" + Math.round(+new Date() / 10) + ".mp3"; //generate a temp filename for polly mp3. will be purged in /tmp/ soon
    console.log("polly voice filename: " + polly_voice);
    if (fs.existsSync('/tmp/sox') && fs.existsSync('/tmp/lame')) {
      console.log('Found lame and sox file');
    } else {
      await copyFiles();
    } //has to invoke this function in order to copy sox / lame to /tmp/ to be able to execute them later. this has to happen every time because the tmp folder get purged every few minutes - todo: implement check if files exist and have the correct permissions +x
    const pollyVoice = await generatePollyAudio(ssml, voice);
    await fs.outputFile('/tmp/' + polly_voice, pollyVoice.AudioStream); //writes pollyAudioStream to writeable /tmp/ folder

    //use this for mixing background with polly voices
    const duration = await mp3Duration('/tmp/' + polly_voice); //calculate length of polly voice. this is important for mixing result because mixing of 5 seconds polly with 10 seconds background will result in 10 seconds polly + background. but you only want the background sfx to be as long as the polly voice
    var file = await mix_polly_with_background(new_background_sound, '/tmp/' + polly_voice, '/tmp/' + sound_mix_result, (duration + 2)); //mixes background with polly and saves to tmp folder, limited by duration of polly voice plus I added 2 seconds
    const uploadFile = await fs.readFile(file); //remove the // in front of the line to enable mixing polly with background then make sure to comment out the next line
    
    var writeToS3 = await writeAudioStreamToS3Bucket(uploadFile, sound_mix_result);
     //send url to Airtable
     var record = await new Promise((resolve, reject) => {
         base('AudioComplete').create({
                 "audioFile": writeToS3.url
               }, function(err, record) {
                 if (err) {
                   console.error(err);
                   return;
                 }
                 resolve(record);
               });
             });
    //use this for neural voice only
    //const uploadFile = await fs.readFile('/tmp/'+polly_voice); //read the file
    //end

    console.log(writeToS3.url);
    return writeToS3.url;
  }
};
/**
 * The End*/


const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
   async handle(handlerInput) {

        base('VoiceAudio').select({ //VoiceAudio is the table name
            view: 'Grid view'
        }).firstPage(function(err, records) {
            if (err) { console.error(err); return; }
            records.forEach(function(record) {
                var speechItems = record.get('SpeechOutput');//these are the colomn names
                var background_audio = record.get('BGAudio');
                var pollyVoiceAT = record.get('PollyVoice');
                var key = record.get('key');
                  generatePollyUrl("<speak>" + speechItems + "</speak>", pollyVoiceAT,background_audio, key); //you may update the voice name here right now its set to Matthew
            });
        });
    
        const speakOutput = "I have completed all builds thank you!";
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    
}
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'HELP_MSG';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speakOutput = 'GOODBYE_MSG';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'FALLBACK_MSG';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};


const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        const speakOutput ='ERROR_MSG';
        console.log(`~~~~ Error handled: ${JSON.stringify(error)}`);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler)
    .addErrorHandlers(
        ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();

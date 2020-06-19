# alexa-polly-background-mixing-nodejs-with-airtables
Polly Voice mixing with background music for nodejs ASK-SDK v2 and this version is a spin off from Dan Mittendorf https://github.com/DanMittendorf/alexa-polly-background-mixing-nodejs and I integrated Airtable. 

With Airtable it allows the user to deploy this skill once to lambda and update the table with the string that you want the Polly voice to say, the background audio link at s3(or where ever you want to store it) and the audio file name. Than ask Alexa to 'mix audio polly' and once complete Alexa will respond I have completed all builds.  You will have all the links in another Airtable table and the file in s3.

This project is based on npm project lambda-audio: npmjs.com/package/lambda-audio and uses SoX (Sound eXchange) command line tool in an AWS Lambda compiled version.

It allows you to generate Amazon Polly Voices in different languages mixed with background music / sounds. 

# Set things up
1. Go here https://github.com/DanMittendorf/alexa-polly-background-mixing-nodejs this is a spin off of Dan Mittendorf's. So please follow his steps.

2. Put your background music in s3 bucket make it publicly accessible both the file and bucket. Make sure the audio file is the same format as polly, so 48kb/s 22050 hz.

3. Sign up for Airable https://airtable.com/invite/r/dKGicWnE

4. Make a new base, call it what ever you want. Have two tables call them what ever you want(I will show where to change this in a bit) or call them what I did which is VoiceAudio and AudioComplete.

5. Name the first field of the first table SpeechOutput(this is your text colomn) make it long text, then create two other fields/colomns name the key(mp3 audio file name), BGAudio(link to the background audio file) make it URL and PollyVoice(the voice you want to use for polly).  In the second table you only need one field/colomn and name that audioFile make it URL 

5. Populate the first table with up to 3 records depending on how long your text is.

6. Lambda Function Timeout set to 30 or 40 seconds might need to play with this for it depends on how many records you want to do at a time.

7. Download or pull this repo.

8. go to your command prompt and make a new skill `Ask new` then copy over the models, index.js, variables.js and all dependincies in the package.json to your new skill.

9. run `npm install` this will install all dependencies and than do step 6 from Dan's repo https://github.com/DanMittendorf/alexa-polly-background-mixing-nodejs

10. update the variables.js with your Airtable api key(which you can find under account overview), in index.js update your base id on line 19(https://airtable.com/api click your base, than JS scroll down till you see the base id) and any table names on lines 162 and 190

11. Deploy your new skill and ask alexa to 'mix audio polly'

12. You may email me directly wrongholt@gmail.com or hit me up on twitter or facebook. https://twitter.com/wrongholt https://www.facebook.com/wrongholt

# Screenshots for reference
<img width="400" alt="airtable base" src="https://s3.us-east-2.amazonaws.com/wrongholt.com/Screen+Shot+2020-04-24+at+12.39.29+PM.png"/>

<img width="400" alt="create a new base" src="https://s3.us-east-2.amazonaws.com/wrongholt.com/Screen+Shot+2020-04-24+at+12.39.42+PM.png"/>

<img width="400" alt="base id" src="https://s3.us-east-2.amazonaws.com/wrongholt.com/Screen+Shot+2020-04-24+at+12.44.49+PM.png"/>



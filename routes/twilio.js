const express = require("express");
const twilio = require("twilio");
const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;
const router = express.Router();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Validate environment variables
const requiredEnvVars = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY",
  "TWILIO_API_SECRET",
  "TWILIO_TWIML_APP_SID",
  "TWILIO_PHONE_NUMBER",
];
const missingEnvVars = requiredEnvVars.filter(
  (varName) => !process.env[varName]
);
if (missingEnvVars.length > 0) {
  console.error("Missing environment variables:", missingEnvVars);
  process.exit(1); // Exit if critical vars are missing
}

// Health check
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    twilioConfigured: missingEnvVars.length === 0,
  });
});

// Access Token
router.get("/access-token", (req, res) => {
  try {
    console.log("Env vars:", {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY: process.env.TWILIO_API_KEY,
      TWILIO_API_SECRET: process.env.TWILIO_API_SECRET,
      TWILIO_TWIML_APP_SID: process.env.TWILIO_TWIML_APP_SID,
    });
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity: "browser", ttl: 3600 }
    );
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });
    token.addGrant(voiceGrant);
    const jwtToken = token.toJwt();
    console.log("Generated access token:", jwtToken);
    res.json({ token: jwtToken });
  } catch (e) {
    console.error("Token generation failed:", e.message);
    res
      .status(500)
      .json({ error: "Failed to generate access token: " + e.message });
  }
});

// Outbound TwiML
router.post("/outbound-twiml", (req, res) => {
  const vr = new twilio.twiml.VoiceResponse();
  const to = req.body.To;
  if (!to) {
    vr.say("No number provided.");
  } else {
    const dial = vr.dial({ callerId: process.env.TWILIO_PHONE_NUMBER });
    dial.number(to);
  }
  res.type("text/xml").send(vr.toString());
});

// Hold
router.post("/hold", async (req, res) => {
  const { callSid } = req.body;
  await client.calls(callSid).update({
    twiml:
      '<Response><Enqueue waitUrl="https://api.twilio.com/cowbell.mp3" /></Response>', // Default hold music
  });
  res.json({ success: true });
});

// Conference
router.post("/conference", async (req, res) => {
  const { callSid, licenseAgentNumber } = req.body;
  await client.calls(callSid).update({
    twiml: `<Response><Dial><Conference>Room${callSid}</Conference></Dial></Response>`,
  });
  await client.calls.create({
    to: licenseAgentNumber,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `/join-conference?room=Room${callSid}`,
  });
  res.json({ success: true });
});

// Join Conference TwiML
router.post("/join-conference", (req, res) => {
  const vr = new twilio.twiml.VoiceResponse();
  const room = req.body.room;
  vr.dial().conference(room);
  res.type("text/xml").send(vr.toString());
});

module.exports = router;

const express = require("express");
const twilio = require("twilio");
const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;
const router = express.Router();

// Initialize Twilio client
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
  console.error("Please set these in your .env file");
}

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    twilioConfigured: missingEnvVars.length === 0,
    twilioRestReady: !!(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ),
    voiceV2TokenReady: missingEnvVars.length === 0,
  });
});

// Debug endpoint to verify credentials (without exposing full values)
router.get("/debug-env", (req, res) => {
  res.json({
    ACCOUNT_SID:
      process.env.TWILIO_ACCOUNT_SID?.substring(0, 10) + "..." || "MISSING",
    API_KEY: process.env.TWILIO_API_KEY?.substring(0, 10) + "..." || "MISSING",
    API_SECRET: !!process.env.TWILIO_API_SECRET,
    TWIML_APP_SID:
      process.env.TWILIO_TWIML_APP_SID?.substring(0, 10) + "..." || "MISSING",
    PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || "MISSING",
    allPresent: missingEnvVars.length === 0,
  });
});

// Access Token for Voice SDK v2 (PRIMARY ENDPOINT)
router.get("/access-token", (req, res) => {
  try {
    if (missingEnvVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingEnvVars.join(", ")}`
      );
    }

    const identity = "browser"; // Fixed identity to match working old app

    console.log("Generating access token for identity:", identity);

    // Create AccessToken
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      {
        identity: identity,
        ttl: 3600, // 1 hour
      }
    );

    // Add Voice Grant with proper configuration
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID, // For outgoing calls
      incomingAllow: true, // Allow incoming calls
    });

    token.addGrant(voiceGrant);

    const jwtToken = token.toJwt();

    console.log("Access token generated successfully");
    console.log(
      "Using TwiML App SID:",
      process.env.TWILIO_TWIML_APP_SID?.substring(0, 10) + "..."
    );

    res.json({
      token: jwtToken,
      identity: identity,
      ttl: 3600,
      debug: {
        accountSid: process.env.TWILIO_ACCOUNT_SID?.substring(0, 10) + "...",
        apiKey: process.env.TWILIO_API_KEY?.substring(0, 10) + "...",
        twimlAppSid: process.env.TWILIO_TWIML_APP_SID?.substring(0, 10) + "...",
        grants: {
          outgoing: true,
          incoming: true,
        },
      },
    });
  } catch (e) {
    console.error("Access token generation failed:", e.message);
    res.status(500).json({
      error: "Failed to generate access token",
      details: e.message,
      missingVars: missingEnvVars,
    });
  }
});

// TwiML for outbound calls - What happens when Twilio processes the call
router.all("/outbound-twiml", (req, res) => {
  const to = req.body.To || req.query.to;
  const vr = new twilio.twiml.VoiceResponse();

  console.log("Outbound TwiML called with To:", to);
  console.log("Request body:", req.body);
  console.log("Request query:", req.query);

  if (!to) {
    vr.say("No number provided. Goodbye.");
  } else {
    // Create dial with caller ID
    const dialOptions = {};
    if (process.env.TWILIO_PHONE_NUMBER) {
      dialOptions.callerId = process.env.TWILIO_PHONE_NUMBER;
    }

    console.log("Dialing with options:", dialOptions);
    const dial = vr.dial(dialOptions);
    dial.number(to);
  }

  console.log("Generated TwiML:", vr.toString());
  res.type("text/xml").send(vr.toString());
});

// Hold functionality
router.post("/hold", async (req, res) => {
  try {
    const { callSid } = req.body;

    if (!callSid) {
      throw new Error("Missing callSid");
    }

    console.log("Putting call on hold:", callSid);

    // Update call with hold music TwiML
    await client.calls(callSid).update({
      twiml:
        '<Response><Enqueue waitUrl="http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.wav" /></Response>',
    });

    res.json({ success: true, message: "Call placed on hold" });
  } catch (e) {
    console.error("Hold operation failed:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Conference functionality
router.post("/conference", async (req, res) => {
  try {
    const { callSid, licenseAgentNumber } = req.body;

    if (!callSid || !licenseAgentNumber) {
      throw new Error("Missing callSid or licenseAgentNumber");
    }

    console.log(
      "Adding to conference - Call:",
      callSid,
      "Agent:",
      licenseAgentNumber
    );

    const conferenceRoom = `Room${callSid.slice(-8)}`; // Use last 8 chars of callSid

    // Put current call into conference
    await client.calls(callSid).update({
      twiml: `<Response><Say>Adding license agent to call...</Say><Dial><Conference>${conferenceRoom}</Conference></Dial></Response>`,
    });

    // Call the license agent and add to same conference
    const agentCall = await client.calls.create({
      to: licenseAgentNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${
        process.env.BASE_URL || req.protocol + "://" + req.get("host")
      }/twilio/join-conference?room=${conferenceRoom}`,
    });

    console.log("Conference initiated, agent call SID:", agentCall.sid);

    res.json({
      success: true,
      message: "Conference initiated",
      conferenceRoom: conferenceRoom,
      agentCallSid: agentCall.sid,
    });
  } catch (e) {
    console.error("Conference operation failed:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// TwiML for joining conference
router.all("/join-conference", (req, res) => {
  const room = req.body.room || req.query.room;
  const vr = new twilio.twiml.VoiceResponse();

  console.log("Agent joining conference room:", room);

  if (room) {
    vr.say("Joining conference call.");
    vr.dial().conference(room);
  } else {
    vr.say("Conference room not specified. Goodbye.");
  }

  console.log("Conference join TwiML:", vr.toString());
  res.type("text/xml").send(vr.toString());
});

// Server-initiated call endpoint (optional)
router.post("/make-call", async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      throw new Error('Missing "to" parameter');
    }

    console.log("Making server-initiated call to:", to);

    const baseUrl =
      process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const url = `${baseUrl}/twilio/outbound-twiml?to=${encodeURIComponent(to)}`;

    const call = await client.calls.create({
      url: url,
      to: to,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    console.log("Server call initiated, SID:", call.sid);

    res.json({
      success: true,
      callSid: call.sid,
      message: "Call initiated successfully",
    });
  } catch (e) {
    console.error("Server call failed:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Transfer call endpoint
router.post("/transfer", async (req, res) => {
  try {
    const { callSid, newNumber } = req.body;

    if (!callSid || !newNumber) {
      throw new Error("Missing callSid or newNumber");
    }

    console.log("Transferring call:", callSid, "to:", newNumber);

    await client.calls(callSid).update({
      twiml: `<Response><Say>Transferring call...</Say><Dial callerId="${process.env.TWILIO_PHONE_NUMBER}">${newNumber}</Dial></Response>`,
    });

    res.json({ success: true, message: "Call transferred" });
  } catch (e) {
    console.error("Transfer failed:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Mute call endpoint
router.post("/mute", async (req, res) => {
  try {
    const { callSid, mute } = req.body;

    if (!callSid) {
      throw new Error("Missing callSid");
    }

    console.log("Mute operation:", callSid, "mute:", mute);

    await client.calls(callSid).update({
      muted: mute === true || mute === "true",
    });

    res.json({
      success: true,
      message: mute ? "Call muted" : "Call unmuted",
    });
  } catch (e) {
    console.error("Mute operation failed:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Test TwiML endpoint for verification
router.get("/test-twiml/:number", (req, res) => {
  const number = req.params.number;
  const vr = new twilio.twiml.VoiceResponse();

  console.log("Test TwiML for number:", number);

  if (process.env.TWILIO_PHONE_NUMBER) {
    const dial = vr.dial({ callerId: process.env.TWILIO_PHONE_NUMBER });
    dial.number(number);
  } else {
    const dial = vr.dial();
    dial.number(number);
  }

  console.log("Test TwiML generated:", vr.toString());
  res.type("text/xml").send(vr.toString());
});

// Get call logs (if you want to fetch call history from Twilio)
router.get("/call-logs", async (req, res) => {
  try {
    const calls = await client.calls.list({ limit: 20 });

    const formattedCalls = calls.map((call) => ({
      sid: call.sid,
      from: call.from,
      to: call.to,
      status: call.status,
      duration: call.duration,
      startTime: call.startTime,
      endTime: call.endTime,
      direction: call.direction,
    }));

    res.json({ success: true, calls: formattedCalls });
  } catch (e) {
    console.error("Failed to fetch call logs:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Webhook endpoints for call status updates (optional)
router.post("/call-status", (req, res) => {
  console.log("Call status webhook:", req.body);

  const { CallSid, CallStatus, From, To, Duration } = req.body;

  // You can log this to your database here
  console.log(
    `Call ${CallSid}: ${CallStatus} (${From} -> ${To}) Duration: ${Duration}s`
  );

  res.status(200).send("OK");
});
// Error handler middleware
router.use((error, req, res, next) => {
  console.error("Twilio router error:", error);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    details: process.env.NODE_ENV === "development" ? error.message : undefined,
  });
});
module.exports = router;

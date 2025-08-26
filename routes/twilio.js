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

// Enhanced Conference functionality
router.post("/conference", async (req, res) => {
  try {
    const {
      callSid,
      licenseAgentNumber,
      holdMusicEnabled = true,
      holdMusicUrl,
      agentName,
      phoneNumber,
      userId,
    } = req.body;

    console.log("=== CONFERENCE REQUEST DEBUG ===");
    console.log("Request body:", req.body);
    console.log("CallSid:", callSid);
    console.log("License Agent Number:", licenseAgentNumber);
    console.log("Agent Name:", agentName);
    console.log("Hold Music Enabled:", holdMusicEnabled);
    console.log("================================");

    if (!licenseAgentNumber) {
      console.error("ERROR: Missing licenseAgentNumber");
      return res.status(400).json({
        success: false,
        error: "Missing licenseAgentNumber",
      });
    }

    // Validate phone number format
    if (!/^\+?[\d\s\-()]+$/.test(licenseAgentNumber)) {
      console.error("ERROR: Invalid phone number format:", licenseAgentNumber);
      return res.status(400).json({
        success: false,
        error: "Invalid phone number format",
      });
    }

    // Validate Twilio environment variables
    if (!process.env.TWILIO_PHONE_NUMBER) {
      console.error("ERROR: TWILIO_PHONE_NUMBER not configured");
      return res.status(500).json({
        success: false,
        error: "Twilio phone number not configured",
      });
    }

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.error("ERROR: Twilio credentials not configured");
      return res.status(500).json({
        success: false,
        error: "Twilio credentials not configured",
      });
    }

    console.log("Using Twilio phone number:", process.env.TWILIO_PHONE_NUMBER);
    console.log(
      "Twilio Account SID:",
      process.env.TWILIO_ACCOUNT_SID?.substring(0, 10) + "..."
    );
    console.log(
      "Twilio Auth Token:",
      process.env.TWILIO_AUTH_TOKEN ? "SET" : "NOT SET"
    );

    // Test Twilio client connection
    try {
      console.log("Testing Twilio client connection...");
      // This will throw an error if the client is not properly configured
      await client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      console.log("Twilio client connection successful");
    } catch (twilioError) {
      console.error("Twilio client connection failed:", twilioError.message);
      return res.status(500).json({
        success: false,
        error: "Twilio client connection failed: " + twilioError.message,
      });
    }

    // Case 1: There's an existing call to add to conference
    if (callSid) {
      console.log("Case 1: Adding to existing call conference");

      const conferenceRoom = `Room${callSid.slice(-8)}`; // Use last 8 chars of callSid
      console.log("Conference room:", conferenceRoom);

      // Create conference with hold music if enabled
      let conferenceTwiML = `<Response>`;

      if (holdMusicEnabled) {
        const musicUrl =
          holdMusicUrl ||
          "http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.wav";
        conferenceTwiML += `<Say>Adding ${
          agentName || "license agent"
        } to call. Please hold.</Say>`;
        conferenceTwiML += `<Dial><Conference waitUrl="${musicUrl}" waitMethod="GET">${conferenceRoom}</Conference></Dial>`;
      } else {
        conferenceTwiML += `<Say>Adding ${
          agentName || "license agent"
        } to call...</Say>`;
        conferenceTwiML += `<Dial><Conference>${conferenceRoom}</Conference></Dial>`;
      }

      conferenceTwiML += `</Response>`;
      console.log("Conference TwiML:", conferenceTwiML);

      // Put current call into conference
      console.log("Updating existing call with conference TwiML...");
      await client.calls(callSid).update({
        twiml: conferenceTwiML,
      });
      console.log("Successfully updated existing call");

      // Call the license agent and add to same conference
      const baseUrl =
        process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      const joinUrl = `${baseUrl}/twilio/join-conference?room=${conferenceRoom}&holdMusic=${holdMusicEnabled}&musicUrl=${encodeURIComponent(
        holdMusicUrl || ""
      )}`;

      console.log("Creating agent call with URL:", joinUrl);

      console.log("Creating agent call for conference with config:", {
        to: licenseAgentNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
        url: joinUrl,
      });

      const agentCall = await client.calls.create({
        to: licenseAgentNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
        url: joinUrl,
      });

      console.log("Conference initiated successfully:", {
        agentCallSid: agentCall.sid,
        status: agentCall.status,
        conferenceRoom: conferenceRoom,
      });

      res.json({
        success: true,
        message: "Conference initiated",
        conferenceRoom: conferenceRoom,
        agentCallSid: agentCall.sid,
        originalCallSid: callSid,
      });
    }
    // Case 2: No existing call - make a direct call to license agent
    else {
      console.log("Case 2: Making direct call to license agent");

      // For direct calls without a publicly accessible webhook, we'll use inline TwiML
      // that just connects the agent with a greeting
      const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello ${
    agentName || "License Agent"
  }, you are receiving a direct call from the dialer system.</Say>
  <Pause length="1"/>
  <Say voice="alice">This call was initiated by a license agent button.</Say>
</Response>`;

      console.log("Creating direct agent call with inline TwiML...");
      console.log("Agent phone number:", licenseAgentNumber);
      console.log("From phone number:", process.env.TWILIO_PHONE_NUMBER);

      console.log("Creating direct agent call with config:", {
        to: licenseAgentNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
        twiml: "inline TwiML response",
      });

      const agentCall = await client.calls.create({
        to: licenseAgentNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
        twiml: twimlResponse,
      });

      console.log("Direct call created successfully:", {
        agentCallSid: agentCall.sid,
        status: agentCall.status,
        to: agentCall.to,
        from: agentCall.from,
      });

      res.json({
        success: true,
        message: `Direct call initiated to ${agentName || "license agent"}`,
        agentCallSid: agentCall.sid,
        type: "direct",
      });
    }
  } catch (e) {
    console.error("=== CONFERENCE ERROR DEBUG ===");
    console.error("Error message:", e.message);
    console.error("Error stack:", e.stack);
    console.error("Error details:", e);
    console.error("==============================");

    res.status(500).json({
      success: false,
      error: e.message,
      details: process.env.NODE_ENV === "development" ? e.stack : undefined,
    });
  }
});

// TwiML for direct agent calls
router.all("/agent-direct-call", (req, res) => {
  const agentName = req.query.agentName || "License Agent";

  const vr = new twilio.twiml.VoiceResponse();
  vr.say(
    `Hello ${agentName}, you have an incoming call from the dialer system.`
  );

  console.log("Direct agent call TwiML:", vr.toString());
  res.type("text/xml").send(vr.toString());
});

// Enhanced TwiML for joining conference
router.all("/join-conference", (req, res) => {
  const room = req.body.room || req.query.room;
  const holdMusic = req.query.holdMusic === "true";
  const musicUrl =
    req.query.musicUrl ||
    "http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.wav";

  const vr = new twilio.twiml.VoiceResponse();

  console.log("Agent joining conference room:", room, "Hold Music:", holdMusic);

  if (room) {
    vr.say("Joining conference call.");

    const dial = vr.dial();
    const conference = dial.conference(room);

    // Set conference attributes
    conference.setAttribute("startConferenceOnEnter", "true");
    conference.setAttribute("endConferenceOnExit", "false");

    if (holdMusic && musicUrl) {
      conference.setAttribute("waitUrl", musicUrl);
      conference.setAttribute("waitMethod", "GET");
    }
  } else {
    vr.say("Conference room not specified. Goodbye.");
  }

  console.log("Conference join TwiML:", vr.toString());
  res.type("text/xml").send(vr.toString());
});

// Conference management endpoints
router.post("/conference/leave", async (req, res) => {
  try {
    const { conferenceRoom, participantType, callSid } = req.body;

    if (!conferenceRoom || !participantType) {
      throw new Error("Missing conferenceRoom or participantType");
    }

    console.log(`Removing ${participantType} from conference:`, conferenceRoom);

    // Get conference participants
    const conference = client.conferences(conferenceRoom);
    const participants = await conference.participants.list();

    let targetParticipant = null;

    // Find the participant to remove based on type
    switch (participantType) {
      case "agent":
        // Remove license agent (usually the last to join)
        targetParticipant = participants.find((p) => p.callSid !== callSid);
        break;
      case "client":
        // Remove client (original caller)
        targetParticipant = participants.find((p) => p.callSid === callSid);
        break;
      case "self":
        // Remove self (current user)
        targetParticipant = participants.find((p) => p.callSid === callSid);
        break;
    }

    if (targetParticipant) {
      await client
        .conferences(conferenceRoom)
        .participants(targetParticipant.callSid)
        .remove();

      res.json({
        success: true,
        message: `${participantType} removed from conference`,
        removedCallSid: targetParticipant.callSid,
      });
    } else {
      res.status(404).json({
        success: false,
        error: `${participantType} not found in conference`,
      });
    }
  } catch (e) {
    console.error("Conference leave operation failed:", e);
    res.status(500).json({ success: false, error: e.message });
  }
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

// Note: Mute functionality is now handled entirely on the frontend
// Twilio backend no longer handles mute/unmute to ensure full audio connection

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

// Agent direct call TwiML endpoint
router.post("/agent-direct-call", (req, res) => {
  console.log("=== AGENT DIRECT CALL ENDPOINT ===");
  console.log("Query params:", req.query);
  console.log("Body:", req.body);

  const agentName = req.query.agentName || "License Agent";

  const vr = new VoiceResponse();
  vr.say(
    `Hello ${agentName}, you are connected to a direct call from the dialer system.`
  );

  console.log("Generated TwiML for agent direct call:", vr.toString());
  res.type("text/xml").send(vr.toString());
});

module.exports = router;

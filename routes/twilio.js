const express = require("express");
const twilio = require("twilio");
const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;
const { VoiceResponse } = require("twilio").twiml;
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
router.get("/access-token", async (req, res) => {
  try {
    if (missingEnvVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingEnvVars.join(", ")}`
      );
    }

    const identity = "browser"; // Fixed identity to match working old app

    console.log("=== ACCESS TOKEN DEBUG ===");
    console.log("Generating access token for identity:", identity);
    console.log(
      "Account SID:",
      process.env.TWILIO_ACCOUNT_SID?.substring(0, 10) + "..."
    );
    console.log(
      "API Key:",
      process.env.TWILIO_API_KEY?.substring(0, 10) + "..."
    );
    console.log(
      "API Secret:",
      process.env.TWILIO_API_SECRET ? "SET" : "MISSING"
    );
    console.log(
      "TwiML App SID:",
      process.env.TWILIO_TWIML_APP_SID?.substring(0, 10) + "..."
    );
    console.log("Region:", process.env.TWILIO_REGION || "ie1");
    console.log("Edge:", process.env.TWILIO_EDGE || "dublin");

    // 🔍 VALIDATE TWIML APP EXISTS
    try {
      console.log("🔍 Validating TwiML Application...");
      const twimlApp = await client
        .applications(process.env.TWILIO_TWIML_APP_SID)
        .fetch();
      console.log("✅ TwiML App found:", {
        sid: twimlApp.sid,
        friendlyName: twimlApp.friendlyName,
        voiceUrl: twimlApp.voiceUrl,
        voiceMethod: twimlApp.voiceMethod,
      });
    } catch (twimlError) {
      console.error("❌ TwiML App validation failed:", twimlError.message);
      return res.status(500).json({
        error: "TwiML Application not found or invalid",
        details: `TwiML App ${process.env.TWILIO_TWIML_APP_SID} does not exist or is not accessible`,
        twimlAppSid: process.env.TWILIO_TWIML_APP_SID,
      });
    }

    // 🔍 VALIDATE API KEY
    try {
      console.log("🔍 Validating API Key...");
      const apiKey = await client.keys(process.env.TWILIO_API_KEY).fetch();
      console.log("✅ API Key found:", {
        sid: apiKey.sid,
        friendlyName: apiKey.friendlyName,
      });
    } catch (apiKeyError) {
      console.error("❌ API Key validation failed:", apiKeyError.message);
      return res.status(500).json({
        error: "API Key not found or invalid",
        details: `API Key ${process.env.TWILIO_API_KEY} does not exist or is not accessible`,
        apiKey: process.env.TWILIO_API_KEY,
      });
    }

    console.log("==========================");

    // 🔧 FIXED: Simplified timestamp generation for JWT (UTC-based)
    const now = Math.floor(Date.now() / 1000); // Current UTC time in seconds

    console.log("🕒 Timestamp Debug (UTC):");
    console.log("Current time (seconds):", now);
    console.log("Current date (UTC):", new Date(now * 1000).toISOString());
    console.log(
      "Server timezone offset (minutes):",
      new Date().getTimezoneOffset()
    );

    // Create AccessToken with simplified timestamp control - let Twilio SDK handle timestamps
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      {
        identity: identity,
        ttl: 3600, // 1 hour
        // Remove explicit timestamp control - let Twilio SDK handle it
        // This prevents future timestamp issues
      }
    );

    // Add Voice Grant with proper configuration and regional optimization
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID, // For outgoing calls
      incomingAllow: true, // Allow incoming calls
      // 🚀 UPDATED FOR IRELAND REGION
      region: process.env.TWILIO_REGION || "ie1", // Ireland region for your new credentials
      edge: process.env.TWILIO_EDGE || "dublin", // Dublin edge for Ireland region
    });

    token.addGrant(voiceGrant);

    const jwtToken = token.toJwt();

    console.log("✅ Access token generated successfully");
    console.log("JWT Token length:", jwtToken.length);
    console.log("Token starts with:", jwtToken.substring(0, 20) + "...");

    // 🔍 DECODE AND VERIFY JWT PAYLOAD
    try {
      const base64Payload = jwtToken.split(".")[1];
      const decodedPayload = JSON.parse(
        Buffer.from(base64Payload, "base64").toString()
      );
      console.log("🔍 JWT Payload Debug:");
      console.log(
        "iat (issued at):",
        decodedPayload.iat,
        "->",
        new Date(decodedPayload.iat * 1000).toISOString()
      );
      console.log(
        "exp (expires):",
        decodedPayload.exp,
        "->",
        new Date(decodedPayload.exp * 1000).toISOString()
      );
      if (decodedPayload.nbf) {
        console.log(
          "nbf (not before):",
          decodedPayload.nbf,
          "->",
          new Date(decodedPayload.nbf * 1000).toISOString()
        );
      }
      console.log(
        "Current time:",
        now,
        "->",
        new Date(now * 1000).toISOString()
      );

      // Check if token is valid timing-wise
      if (decodedPayload.iat > now + 300) {
        // If issued time is more than 5 minutes in the future
        console.error(
          "❌ TOKEN ISSUED IN THE FUTURE! This will cause JWT invalid error"
        );
        console.error("Token iat:", decodedPayload.iat, "Current time:", now);
      } else if (decodedPayload.exp < now) {
        console.error("❌ TOKEN ALREADY EXPIRED!");
      } else {
        console.log("✅ Token timestamps look correct");
      }
    } catch (decodeError) {
      console.error(
        "❌ Failed to decode JWT for debugging:",
        decodeError.message
      );
    }

    res.json({
      token: jwtToken,
      identity: identity,
      ttl: 3600,
      debug: {
        accountSid: process.env.TWILIO_ACCOUNT_SID?.substring(0, 10) + "...",
        apiKey: process.env.TWILIO_API_KEY?.substring(0, 10) + "...",
        twimlAppSid: process.env.TWILIO_TWIML_APP_SID?.substring(0, 10) + "...",
        region: process.env.TWILIO_REGION || "ie1",
        edge: process.env.TWILIO_EDGE || "dublin",
        grants: {
          outgoing: true,
          incoming: true,
        },
      },
    });
  } catch (e) {
    console.error("=== ACCESS TOKEN ERROR ===");
    console.error("Error message:", e.message);
    console.error("Error stack:", e.stack);
    console.error("Missing vars:", missingEnvVars);
    console.error("==========================");

    res.status(500).json({
      error: "Failed to generate access token",
      details: e.message,
      missingVars: missingEnvVars,
    });
  }
});

// Backup simple token endpoint - minimal configuration
router.get("/access-token-simple", async (req, res) => {
  try {
    if (missingEnvVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingEnvVars.join(", ")}`
      );
    }

    const identity = "browser";

    console.log("=== SIMPLE TOKEN GENERATION ===");
    console.log("Current server time:", new Date().toISOString());
    console.log("Current UTC timestamp:", Math.floor(Date.now() / 1000));

    // Simple token generation - let Twilio SDK handle all timestamps
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET
    );

    token.identity = identity;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    token.addGrant(voiceGrant);

    const jwtToken = token.toJwt();

    console.log("✅ Simple token generated");
    console.log("=================================");

    res.json({
      token: jwtToken,
      identity: identity,
      method: "simple",
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Simple token generation failed:", e.message);
    res.status(500).json({
      error: "Failed to generate simple access token",
      details: e.message,
    });
  }
});

// Ultra-simple token endpoint - bypass all validations (for debugging)
router.get("/access-token-debug", async (req, res) => {
  try {
    console.log("=== DEBUG TOKEN GENERATION ===");
    console.log("Environment variables check:");
    console.log("ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID ? "SET" : "MISSING");
    console.log("API_KEY:", process.env.TWILIO_API_KEY ? "SET" : "MISSING");
    console.log("API_SECRET:", process.env.TWILIO_API_SECRET ? "SET" : "MISSING");
    console.log("TWIML_APP_SID:", process.env.TWILIO_TWIML_APP_SID ? "SET" : "MISSING");

    // Basic validation only
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_API_KEY || !process.env.TWILIO_API_SECRET) {
      throw new Error("Missing basic Twilio credentials");
    }

    const identity = "browser";
    
    // Minimal token generation with no external API calls
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET
    );

    token.identity = identity;

    // Basic voice grant without external validation
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID || "PLACEHOLDER",
      incomingAllow: true,
    });

    token.addGrant(voiceGrant);

    const jwtToken = token.toJwt();

    console.log("✅ Debug token generated successfully");
    console.log("Token length:", jwtToken.length);
    console.log("===================================");

    res.json({
      token: jwtToken,
      identity: identity,
      method: "debug",
      serverTime: new Date().toISOString(),
      timestamp: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    console.error("Debug token generation failed:", e.message);
    console.error("Stack:", e.stack);
    res.status(500).json({
      error: "Failed to generate debug access token",
      details: e.message,
      stack: e.stack,
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

// Enhanced Conference functionality - FIXED
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
    console.log("Phone Number:", phoneNumber);
    console.log("User ID:", userId);
    console.log("================================");

    // Validation
    if (!licenseAgentNumber) {
      console.error("ERROR: Missing licenseAgentNumber");
      return res.status(400).json({
        success: false,
        error: "Missing licenseAgentNumber",
      });
    }

    // Validate phone number format
    const cleanNumber = licenseAgentNumber.replace(/[\s\-()]/g, "");
    if (!/^\+?\d{10,15}$/.test(cleanNumber)) {
      console.error("ERROR: Invalid phone number format:", licenseAgentNumber);
      return res.status(400).json({
        success: false,
        error: "Invalid phone number format",
      });
    }

    // Validate environment variables
    if (
      !process.env.TWILIO_PHONE_NUMBER ||
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN
    ) {
      console.error("ERROR: Missing Twilio configuration");
      return res.status(500).json({
        success: false,
        error: "Twilio configuration incomplete",
      });
    }

    // Test Twilio client connection
    try {
      console.log("Testing Twilio client connection...");
      await client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      console.log("Twilio client connection successful");
    } catch (twilioError) {
      console.error("Twilio client connection failed:", twilioError);
      return res.status(500).json({
        success: false,
        error: "Twilio client connection failed: " + twilioError.message,
      });
    }

    // Case 1: Adding to existing call conference (callSid provided)
    if (callSid && callSid.trim() !== "") {
      console.log("Case 1: Adding agent to existing call conference");

      // Verify the call exists and is active
      try {
        const existingCall = await client.calls(callSid).fetch();
        console.log("Existing call status:", existingCall.status);

        if (
          existingCall.status === "completed" ||
          existingCall.status === "failed"
        ) {
          throw new Error(
            `Call ${callSid} is no longer active (status: ${existingCall.status})`
          );
        }
      } catch (callFetchError) {
        console.error("Failed to fetch existing call:", callFetchError);
        return res.status(400).json({
          success: false,
          error: `Invalid or inactive call: ${callFetchError.message}`,
        });
      }

      // Generate unique conference room name
      const conferenceRoom = `ConferenceRoom_${callSid.slice(
        -8
      )}_${Date.now()}`;
      console.log("Conference room:", conferenceRoom);

      try {
        // First, move the existing call into conference
        const conferenceUrl =
          holdMusicEnabled && holdMusicUrl
            ? holdMusicUrl
            : "http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.wav";

        const conferenceTwiML = new VoiceResponse();
        conferenceTwiML.say(
          `Adding ${agentName || "license agent"} to the call. Please wait.`
        );

        const dial = conferenceTwiML.dial();
        const conference = dial.conference(conferenceRoom, {
          startConferenceOnEnter: true,
          endConferenceOnExit: false,
          waitUrl: conferenceUrl,
          waitMethod: "GET",
          maxParticipants: 10,
        });

        console.log("Generated conference TwiML:", conferenceTwiML.toString());

        // Update existing call to join conference
        console.log("Moving existing call to conference...");
        const updatedCall = await client.calls(callSid).update({
          twiml: conferenceTwiML.toString(),
        });

        console.log(
          "Existing call updated successfully, status:",
          updatedCall.status
        );

        // Wait a moment for the first participant to join
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Create TwiML for agent to join the same conference
        const agentTwiML = new VoiceResponse();
        agentTwiML.say(
          `Hello ${agentName || "License Agent"}, joining conference call.`
        );

        const agentDial = agentTwiML.dial();
        const agentConference = agentDial.conference(conferenceRoom, {
          startConferenceOnEnter: true,
          endConferenceOnExit: false,
          maxParticipants: 10,
        });

        console.log("Generated agent TwiML:", agentTwiML.toString());

        // Call the license agent
        console.log("Calling license agent to join conference...");
        const agentCall = await client.calls.create({
          to: cleanNumber,
          from: process.env.TWILIO_PHONE_NUMBER,
          twiml: agentTwiML.toString(),
        });

        console.log("Agent call created successfully:", {
          agentCallSid: agentCall.sid,
          status: agentCall.status,
          to: agentCall.to,
        });

        res.json({
          success: true,
          message: "Conference initiated successfully",
          conferenceRoom: conferenceRoom,
          agentCallSid: agentCall.sid,
          originalCallSid: callSid,
          agentCallStatus: agentCall.status,
        });
      } catch (conferenceError) {
        console.error("Conference creation error:", conferenceError);
        throw new Error(
          `Failed to create conference: ${conferenceError.message}`
        );
      }
    }
    // Case 2: Direct call to license agent (no existing call)
    else {
      console.log("Case 2: Making direct call to license agent");

      const directTwiML = new VoiceResponse();
      directTwiML.say(
        `Hello ${
          agentName || "License Agent"
        }, you have an incoming call from the dialer system.`
      );
      directTwiML.pause({ length: 1 });

      // If there's a phoneNumber provided, mention it
      if (phoneNumber) {
        directTwiML.say(`This call is related to dialing ${phoneNumber}.`);
      } else {
        directTwiML.say(
          "This is a direct call initiated by the license agent button."
        );
      }

      console.log("Creating direct agent call...");
      console.log("Direct call TwiML:", directTwiML.toString());

      const agentCall = await client.calls.create({
        to: cleanNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
        twiml: directTwiML.toString(),
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
        agentCallStatus: agentCall.status,
      });
    }
  } catch (error) {
    console.error("=== CONFERENCE ERROR DEBUG ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Error type:", error.constructor.name);
    console.error("Twilio Error Code:", error.code);
    console.error("Twilio Error Status:", error.status);
    console.error("==============================");

    // More specific error handling
    let errorMessage = error.message;
    let statusCode = 500;

    if (error.code === 21220) {
      errorMessage = "Invalid phone number format";
      statusCode = 400;
    } else if (error.code === 20003) {
      errorMessage = "Authentication failed - check Twilio credentials";
      statusCode = 401;
    } else if (error.code === 21217) {
      errorMessage = "Phone number not verified or invalid";
      statusCode = 400;
    } else if (error.code === 20404) {
      errorMessage = "Call not found or already ended";
      statusCode = 404;
    }

    // Send detailed error response
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      errorType: error.constructor.name,
      twilioCode: error.code || null,
      twilioStatus: error.status || null,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// TwiML for direct agent calls
router.all("/agent-direct-call", (req, res) => {
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

// End Client Call - Remove client from conference
router.post("/end-client-call", async (req, res) => {
  try {
    console.log("=== END CLIENT CALL REQUEST ===");
    console.log("Body:", req.body);

    const { callSid, userId } = req.body;

    if (!callSid) {
      return res.status(400).json({
        success: false,
        error: "CallSid is required",
      });
    }

    // Get conference participants for this call
    const conferences = await client.conferences.list({
      friendlyName: `Room${callSid.slice(-8)}`,
      status: "in-progress",
    });

    console.log("Found conferences:", conferences.length);

    if (conferences.length > 0) {
      const conference = conferences[0];
      console.log("Conference SID:", conference.sid);

      // Get participants
      const participants = await client
        .conferences(conference.sid)
        .participants.list();
      console.log(
        "Conference participants:",
        participants.map((p) => ({
          callSid: p.callSid,
          muted: p.muted,
          hold: p.hold,
        }))
      );

      // Find and remove the client (original call participant)
      for (const participant of participants) {
        if (participant.callSid === callSid) {
          console.log("Removing client participant:", participant.callSid);
          await client
            .conferences(conference.sid)
            .participants(participant.callSid)
            .remove();
          break;
        }
      }
    }

    res.json({
      success: true,
      message: "Client removed from conference",
    });
  } catch (error) {
    console.error("Error ending client call:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// End License Agent Call - Remove license agent from conference
router.post("/end-license-agent-call", async (req, res) => {
  try {
    console.log("=== END LICENSE AGENT CALL REQUEST ===");
    console.log("Body:", req.body);

    const { callSid, userId } = req.body;

    if (!callSid) {
      return res.status(400).json({
        success: false,
        error: "CallSid is required",
      });
    }

    // Get conference participants for this call
    const conferences = await client.conferences.list({
      friendlyName: `Room${callSid.slice(-8)}`,
      status: "in-progress",
    });

    console.log("Found conferences:", conferences.length);

    if (conferences.length > 0) {
      const conference = conferences[0];
      console.log("Conference SID:", conference.sid);

      // Get participants
      const participants = await client
        .conferences(conference.sid)
        .participants.list();
      console.log(
        "Conference participants:",
        participants.map((p) => ({
          callSid: p.callSid,
          muted: p.muted,
          hold: p.hold,
        }))
      );

      // Find and remove the license agent (look for participant that's not the original call)
      for (const participant of participants) {
        if (participant.callSid !== callSid) {
          console.log(
            "Removing license agent participant:",
            participant.callSid
          );
          await client
            .conferences(conference.sid)
            .participants(participant.callSid)
            .remove();
          break;
        }
      }
    }

    res.json({
      success: true,
      message: "License agent removed from conference",
    });
  } catch (error) {
    console.error("Error ending license agent call:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;

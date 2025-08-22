const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://*.ngrok-free.app",
    ],
    credentials: true,
  })
);
app.use(express.json());

const { router: authRouter, verifyToken } = require("./routes/auth");
const twilioRouter = require("./routes/twilio");
const dialRouter = require("./routes/dial");

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

app.use("/auth", authRouter);
app.use("/twilio", verifyToken, twilioRouter);
app.use("/dial", verifyToken, dialRouter);

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server on port ${port}`));

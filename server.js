const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:3000", // local frontend (dev)
      "http://localhost:3001", // another local frontend
      /\.onrender\.com$/, // allow any frontend hosted on Render
      /\.vercel\.app$/, // allow any frontend hosted on Vercel
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
app.use("/twilio", twilioRouter); // Remove verifyToken to match old server.js
app.use("/dial", verifyToken, dialRouter);
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server on port ${port}`));

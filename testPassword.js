const bcrypt = require("bcryptjs");

const plainPassword = "OwnerPass123!"; // What you're typing in the login form
const storedHash =
  "$2b$10$COEFenbvuIF2OrWlca0Cuucf2T7p/zXiV8cWOXiQCCzCLQuS5dU/6"; // Copy from Compass

bcrypt.compare(plainPassword, storedHash, (err, match) => {
  if (err) console.error("Error:", err);
  console.log("Password match:", match); // Should print true
});

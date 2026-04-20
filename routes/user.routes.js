const { Router } = require("express");

const router = Router();

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
    // Implement registration logic here
    res.status(201).json({ message: "User registered successfully" });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
    // Implement login logic here
    res.status(200).json({ message: "User logged in successfully" });
});

module.exports = router;
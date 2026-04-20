const { Router } = require("express");
const router = Router();
const userController = require("../controllers/user.controllers");

router.post("/register", userController.registerUser);
router.post("/login", userController.signInUser);

module.exports = router;
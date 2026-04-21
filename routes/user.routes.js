const { Router } = require("express");
const router = Router();
const userController = require("../controllers/user.controllers");

router.post("/register", userController.registerUser);
router.post("/login", userController.signInUser);
router.post("/forgot_password", userController.forgotPassword);
router.post("/reset_password", userController.resetPassword);
router.post("/delete_account", userController.deleteAccount);

module.exports = router;
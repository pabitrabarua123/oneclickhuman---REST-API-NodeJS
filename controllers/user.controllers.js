const bcrypt = require("bcrypt");
const userModel = require("../models/user.model");

const saltRounds = 10;

const userController = {
  // Register a new user
  registerUser: (req, res) => {
    const { email, password } = req.body;

    try {
      // check existing user
      userModel.findUserByEmail(email, async (err, result) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "DB error" });
        }

        if (result.length > 0) {
          return res
            .status(200)
            .json({ id: 0, status: "User already exist!" });
        }

        // hash password
        const hash = await bcrypt.hash(password, saltRounds);

        let currentDate = new Date().toJSON().slice(0, 10);

        userModel.createUser(
          { email, password: hash, date: currentDate },
            (err, response) => {
              if (err) {
                console.error(err);
                return res.status(500).json({ error: "Insert failed" });
              }

            // Mail to user for verification
            sendMail(email, response.insertId);

            const edt = new Date().toLocaleString("en-US", {
              timeZone: "America/New_York",
              dateStyle: "full",
              timeStyle: "full",
            });

            res.status(200).json({
              id: response.insertId,
              user_email: email,
              login: "on-verification",
              time: edt,
              role: 0,
            });
          }
        );
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Something went wrong" });
    }
  },

  // Sign in a user
  signInUser: (req, res) => {
    res.send('User sign-in endpoint');
  }, 
}

export default userController;
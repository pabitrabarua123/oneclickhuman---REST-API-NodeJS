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
  signInUser: async (req, res) => {
     const { email, password } = req.body;

     try {
        userModel.findUserByEmail(email, async (err, result) => {
          if (err) {
             console.error(err);
             return res.status(500).json({ error: "DB error" });
          }

          if (result.length === 0) {
            return res.status(200).json({ login: "failure" });
          }

          const user = result[0];
          // compare password
          const validPassword = await bcrypt.compare(password, user.password);

          if (!validPassword) {
             return res.status(200).json({ login: "failure" });
          }

          const edt = new Date().toLocaleString("en-US", {
             timeZone: "America/New_York",
             dateStyle: "full",
             timeStyle: "full",
          });

          return res.status(200).json({
            login: "success",
            id: user.id,
            time: edt,
            user_email: user.email,
            role: user.role,
          });
       });
     } catch (error) {
         console.error(error);
         res.status(500).json({ error: "Something went wrong" });
     }
  }, 

  // Forgot password
  forgotPassword: async (req, res) => {
     const { email } = req.body;

     try {
        // generate 4-digit OTP (1000–9999)
        const otp = Math.floor(1000 + Math.random() * 9000);

        userModel.saveOTP(email, otp, async (err, result) => {
          if (err) {
             console.error(err);
             return res.status(500).json({ error: "DB error" });
          }

          try {
            const sent = await sendMailOTP(email, otp);
            if (sent) {
               return res.status(200).json({ status: "success" });
            } else {
               return res.status(500).json({ status: "email_failed" });
            }
          } catch (error) {
              console.error(error);
              return res.status(500).json({ error: "Mail error" });
          }
       });
      } catch (error) {
         console.error(error);
         res.status(500).json({ error: "Something went wrong" });
      }
   },

   // Reset password
   resetPassword : async (req, res) => {
     const { email, new_password, otp } = req.body;

     try {
      // verify OTP
      userModel.verifyOTP(email, otp, async (err, result) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "DB error" });
        }

        if (result.length === 0) {
          return res.status(200).json({ status: "failure" });
        }

        // hash new password
        const hashedPassword = await bcrypt.hash(new_password, saltRounds);

        // update password
        userModel.updatePassword(email, hashedPassword, (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Update failed" });
          }

        // delete OTP after success
        userModel.deleteOTP(email, (err) => {
          if (err) {
            console.error(err);
          }
          
          return res.status(200).json({ status: "success" });
         });
       });
     });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Something went wrong" });
    }
  }, 
  
  // Delete user account
  deleteAccount: async (req, res) => {
    const { user_id } = req.body;

    try {
      userModel.deleteUserById(user_id, (err, result) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "DB error" });
        }

        if (result.affectedRows === 0) {
          return res
           .status(200)
           .json({ status: "Account not found" });
        }

        return res.status(200).json({ status: "success" });
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Something went wrong" });
    }
  },

};

export default userController;
const db = require("../config/connection");

// check user exists
exports.findUserByEmail = (email, callback) => {
  db.query("SELECT * FROM user WHERE email = ?", [email], callback);
};

// create user
exports.createUser = (userData, callback) => {
  const { email, password, date } = userData;

  db.query(
    `INSERT INTO user (email, password, status, daily_quota, quota_updated_date)
     VALUES (?, ?, 0, 1500, ?)`,
    [email, password, date],
    callback
  );
};

// forget password - save OTP
exports.saveOTP = (email, otp, callback) => {
  const query = `
    INSERT INTO reset_password (email, otp)
    VALUES (?, ?)
  `;
  db.query(query, [email, otp], callback);
};

// verify OTP
exports.verifyOTP = (email, otp, callback) => {
  const query = `
    SELECT * FROM reset_password 
    WHERE email = ? AND otp = ?
  `;
  db.query(query, [email, otp], callback);
};

// update password
exports.updatePassword = (email, password, callback) => {
  const query = `
    UPDATE user SET password = ? WHERE email = ?
  `;
  db.query(query, [password, email], callback);
};

// delete OTP after use
exports.deleteOTP = (email, callback) => {
  const query = `
    DELETE FROM reset_password WHERE email = ?
  `;
  db.query(query, [email], callback);
};

// delete user by id
exports.deleteUserById = (userId, callback) => {
  const query = `DELETE FROM user WHERE id = ?`;
  db.query(query, [userId], callback);
};
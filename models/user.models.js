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
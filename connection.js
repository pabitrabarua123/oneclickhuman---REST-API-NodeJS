//jshint esversion: 6
var mysql = require('mysql');

var pool = mysql.createPool({
  connectionLimit:1000,
  host: "localhost",
  user: "oneclickhuman_new_user",
  password: "BCor08TVmbssi",
  database:"oneclickhuman_new_db"
});

pool.getConnection((err,connection)=> {
  if(err)
  throw err;
  console.log('Database connected successfully');
  connection.release();
});

module.exports = pool;
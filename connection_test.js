//jshint esversion: 6
var mysql_test = require('mysql');

var pool_test = mysql_test.createPool({
  connectionLimit:1000,
  host: "localhost",
  user: "oneclickhuman_user",
  password: "RBms37bPLkjwe",
  database:"oneclickhuman_db"
});

pool_test.getConnection((err,connection)=> {
  if(err)
  throw err;
  console.log('Database connected successfully');
  connection.release();
});

module.exports = pool_test;
const express = require('express');
const path = require('path');
const config = require('./config');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', require('./routes/publicApi'));
app.use('/api/admin', require('./routes/adminApi'));

const PORT = process.env.PORT || config.port || 3000;
app.listen(PORT, () => {
  console.log(`叫料系統已啟動：http://localhost:${PORT}`);
});

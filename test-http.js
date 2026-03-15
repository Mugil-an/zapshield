const { query } = require('./src/config/db');
const http = require('http');
const fs = require('fs');

async function testHttp() {
  try {
    const adminRes = await query(`SELECT * FROM admin_users WHERE email = 'admin@zapshield.in'`);
    const jwt = require('jsonwebtoken');
    const admin = adminRes.rows[0];
    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role },
      process.env.ADMIN_JWT_SECRET || 'admin-super-secret-jwt-key-minimum-32-chars',
      { expiresIn: '1h' }
    );

    const zoneRes = await query(`SELECT id FROM zones WHERE dark_store_name = 'Koramangala'`);
    const zoneId = zoneRes.rows[0].id;

    const postData = JSON.stringify({
      zone_id: zoneId,
      trigger_type: 'rain_burst',
      actual_value: 7.5,
      duration_hours: 1.5,
      dispatch_volume_pct: 15
    });

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/triggers/simulate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        fs.writeFileSync('http-out.json', data);
        console.log('Done writing HTTP response to http-out.json');
      });
    });

    req.on('error', console.error);
    req.write(postData);
    req.end();

  } catch(e) {
    console.error(e);
  }
}
testHttp();

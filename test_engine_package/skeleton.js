// tests/core/apiClient.js
const axios = require('axios');

const api = axios.create({
  baseURL: 'http://localhost:3000/api/v1',
  headers: {
    Authorization: `Bearer ${process.env.TOKEN}`,
    'Content-Type': 'application/json'
  }
});

module.exports = api;

// tests/core/testRunner.js
const api = require('./apiClient');

async function runCrudTest({ entity, createPayload, updatePayload }) {
  try {
    const created = await api.post(`/${entity}`, createPayload);
    const id = created.data.data.id;

    const updated = await api.put(`/${entity}/${id}`, updatePayload);

    if (!updated.data.success) throw new Error('Update failed');

    await api.delete(`/${entity}/${id}`);

    console.log(`✅ ${entity} test passed`);
  } catch (err) {
    console.error(`❌ ${entity} test failed`, err.message);
  }
}

module.exports = runCrudTest;

// tests/customer/crud.test.js
const runCrudTest = require('../core/testRunner');

runCrudTest({
  entity: 'customer',
  createPayload: {
    name: 'Test',
    email: 'test@example.com',
    phone: '123456'
  },
  updatePayload: {
    name: 'Updated'
  }
});

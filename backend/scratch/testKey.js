import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const key = process.env.CLAUDE_API_KEY;
console.log('Testing Key:', key);

async function testClaude() {
  console.log('\n--- Testing Anthropic Claude SDK ---');
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307', // dùng model rẻ nhất để test
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    console.log('Claude Success! Response:', message.content[0]?.text);
    return true;
  } catch (err) {
    console.error('Claude Error:', err.message);
    return false;
  }
}

async function testGemini() {
  console.log('\n--- Testing Gemini API ---');
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const resp = await axios.post(url, {
      contents: [{ parts: [{ text: 'Hi' }] }]
    }, { timeout: 10000 });
    console.log('Gemini Success! Response:', resp.data?.candidates?.[0]?.content?.parts?.[0]?.text);
    return true;
  } catch (err) {
    console.error('Gemini Error:', err.response?.data?.error?.message || err.message);
    return false;
  }
}

async function testGemini15() {
  console.log('\n--- Testing Gemini 1.5 API ---');
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
    const resp = await axios.post(url, {
      contents: [{ parts: [{ text: 'Hi' }] }]
    }, { timeout: 10000 });
    console.log('Gemini 1.5 Success! Response:', resp.data?.candidates?.[0]?.content?.parts?.[0]?.text);
    return true;
  } catch (err) {
    console.error('Gemini 1.5 Error:', err.response?.data?.error?.message || err.message);
    return false;
  }
}

async function main() {
  await testClaude();
  await testGemini();
  await testGemini15();
}

main();

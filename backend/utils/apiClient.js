/**
 * apiClient.js — Shared HTTP client với retry + exponential backoff
 * Dùng cho tất cả các request đến football-data.org
 */

import axios from 'axios';

const BASE_URL = 'https://api.football-data.org/v4';
const DELAY_MS = 1000;        // Delay cơ bản giữa các request thông thường
const MAX_RETRIES = 3;        // Số lần thử lại tối đa
const BASE_BACKOFF_MS = 6000; // Bắt đầu từ 6s (giới hạn 10 req/phút free tier)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getAuthHeaders() {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key || key === 'your_football_data_key_here') {
    throw new Error('FOOTBALL_DATA_API_KEY chưa được cấu hình trong file .env');
  }
  return { 'X-Auth-Token': key };
}

/**
 * Fetch từ football-data.org với retry + exponential backoff
 * Lần 1 thất bại → chờ 6s → lần 2 thất bại → chờ 12s → lần 3 thất bại → throw
 *
 * @param {string} endpoint - path sau BASE_URL, vd: '/competitions/PL/teams'
 * @param {object} params - query params
 * @returns {Promise<object>} - response data
 */
export async function footballDataGet(endpoint, params = {}) {
  const url = `${BASE_URL}${endpoint}`;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.get(url, {
        headers: getAuthHeaders(),
        params,
        timeout: 15000,
      });
      return res.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isRetryable = !status || status === 429 || status >= 500;

      if (!isRetryable || attempt === MAX_RETRIES) break;

      // Exponential backoff: 6s, 12s, 24s
      const waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[API] Lần ${attempt}/${MAX_RETRIES} thất bại (HTTP ${status || err.code}) — thử lại sau ${waitMs / 1000}s...`
      );
      await sleep(waitMs);
    }
  }

  // Ném lỗi có thông tin rõ ràng
  const status = lastError.response?.status;
  const msg = lastError.response?.data?.message || lastError.message;
  throw new Error(`football-data.org trả về lỗi${status ? ` ${status}` : ''}: ${msg}`);
}

/**
 * Delay tiêu chuẩn giữa các lần gọi API (để không vượt rate limit)
 */
export async function apiDelay(ms = DELAY_MS) {
  await sleep(ms);
}

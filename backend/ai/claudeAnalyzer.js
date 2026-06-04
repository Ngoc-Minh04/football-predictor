/**
 * Gemini AI Analyzer
 * - Phân tích trận đấu bằng tiếng Việt
 * - Cache kết quả vào DB (analysis_cache) để tránh tốn request lặp lại
 * - Model: gemini-2.0-flash (miễn phí, nhanh)
 */

import axios from 'axios';
import { getDatabase, queryGet, queryRun } from '../db/database.js';

// Tên đội bóng phổ biến → tiếng Việt
const TEAM_NAME_VI = {
  // World Cup / Euro đội quốc gia
  'Argentina':       'Argentina',
  'France':          'Pháp',
  'Brazil':          'Brazil',
  'England':         'Anh',
  'Germany':         'Đức',
  'Spain':           'Tây Ban Nha',
  'Portugal':        'Bồ Đào Nha',
  'Netherlands':     'Hà Lan',
  'Italy':           'Ý',
  'Belgium':         'Bỉ',
  'Croatia':         'Croatia',
  'Morocco':         'Ma-rốc',
  'Senegal':         'Sê-nê-gan',
  'Japan':           'Nhật Bản',
  'South Korea':     'Hàn Quốc',
  'Australia':       'Úc',
  'USA':             'Mỹ',
  'Mexico':          'Mexico',
  'Uruguay':         'Uruguay',
  'Colombia':        'Colombia',
  'Ecuador':         'Ecuador',
  'Switzerland':     'Thụy Sĩ',
  'Denmark':         'Đan Mạch',
  'Poland':          'Ba Lan',
  'Serbia':          'Serbia',
  'Ghana':           'Ghana',
  'Cameroon':        'Cameroon',
  'Tunisia':         'Tunisia',
  'South Africa':    'Nam Phi',
  'Nigeria':         'Nigeria',
  'Egypt':           'Ai Cập',
  'Saudi Arabia':    'Ả Rập Xê Út',
  'Iran':            'Iran',
  'Qatar':           'Qatar',
  'Canada':          'Canada',
  'Wales':           'Xứ Wales',
  'Ukraine':         'Ukraine',
  'Austria':         'Áo',
  'Hungary':         'Hungary',
  'Czech Republic':  'Cộng hòa Séc',
  'Slovakia':        'Slovakia',
  'Romania':         'Romania',
  'Turkey':          'Thổ Nhĩ Kỳ',
  'Scotland':        'Scotland',
  'Albania':         'Albania',
  'Slovenia':        'Slovenia',
  'Georgia':         'Georgia',

  // Premier League
  'Manchester City':    'Man City',
  'Manchester United':  'Man Utd',
  'Arsenal':            'Arsenal',
  'Liverpool':          'Liverpool',
  'Chelsea':            'Chelsea',
  'Tottenham Hotspur':  'Tottenham',
  'Newcastle United':   'Newcastle',
  'Aston Villa':        'Aston Villa',
  'Brighton & Hove Albion': 'Brighton',
  'West Ham United':    'West Ham',
  'Brentford':          'Brentford',
  'Fulham':             'Fulham',
  'Crystal Palace':     'Crystal Palace',
  'Wolverhampton Wanderers': 'Wolves',
  'Everton':            'Everton',
  'Nottingham Forest':  'Nott\'m Forest',
  'Luton Town':         'Luton',
  'Sheffield United':   'Sheffield Utd',
  'Burnley':            'Burnley',
  'AFC Bournemouth':    'Bournemouth',

  // La Liga
  'Real Madrid':        'Real Madrid',
  'FC Barcelona':       'Barcelona',
  'Atletico Madrid':    'Atletico Madrid',
  'Sevilla FC':         'Sevilla',
  'Real Sociedad':      'Real Sociedad',
  'Athletic Club':      'Athletic Bilbao',
  'Real Betis':         'Real Betis',
  'Villarreal CF':      'Villarreal',
  'Valencia CF':        'Valencia',

  // Bundesliga
  'FC Bayern München':  'Bayern Munich',
  'Borussia Dortmund':  'Dortmund',
  'Bayer 04 Leverkusen': 'Leverkusen',
  'RB Leipzig':         'Leipzig',
  'VfB Stuttgart':      'Stuttgart',

  // Serie A
  'Juventus':           'Juventus',
  'Inter Milan':        'Inter Milan',
  'AC Milan':           'AC Milan',
  'SSC Napoli':         'Napoli',
  'AS Roma':            'Roma',
  'Lazio':              'Lazio',

  // Ligue 1
  'Paris Saint-Germain': 'PSG',
  'Olympique de Marseille': 'Marseille',
  'Olympique Lyonnais': 'Lyon',
  'Monaco':             'Monaco',

  // Champions League
  'Real Madrid CF':     'Real Madrid',
  'Chelsea FC':         'Chelsea',
  'Liverpool FC':       'Liverpool',
  'Arsenal FC':         'Arsenal',
};

/**
 * Chuyển tên đội sang tiếng Việt (fallback = tên gốc)
 */
function toViName(name) {
  if (!name) return name;
  return TEAM_NAME_VI[name] || name;
}

/**
 * Build prompt phân tích bằng tiếng Việt
 */
function buildPrompt(context) {
  const {
    homeTeam, awayTeam, league,
    homeForm, awayForm, h2h, injuries,
    situationalFactors, prediction,
  } = context;

  const homeVi = toViName(homeTeam);
  const awayVi  = toViName(awayTeam);

  return `Bạn là chuyên gia phân tích bóng đá hàng đầu. Hãy phân tích trận đấu sau và trả về kết quả bằng TIẾNG VIỆT.

**Trận đấu**: ${homeVi} vs ${awayVi} (${league || 'Giải không xác định'})

**Phong độ gần đây (5 trận gần nhất)**:
- ${homeVi}: ${homeForm || 'Chưa có dữ liệu'}
- ${awayVi}: ${awayForm || 'Chưa có dữ liệu'}

**Đối đầu trực tiếp (H2H)**: ${h2h || 'Không có dữ liệu H2H gần đây'}

**Chấn thương / Treo giò**: ${injuries || 'Không có thông tin'}

**Yếu tố đặc biệt**: ${JSON.stringify(situationalFactors || {})}

**Dự đoán thống kê**:
- Tỉ số dự đoán: ${prediction?.score ? `${prediction.score.home}-${prediction.score.away}` : 'Chưa tính'}
- Xác suất thắng: ${homeVi} ${((prediction?.result?.home || 0) * 100).toFixed(0)}%, Hòa ${((prediction?.result?.draw || 0) * 100).toFixed(0)}%, ${awayVi} ${((prediction?.result?.away || 0) * 100).toFixed(0)}%
- Độ tin cậy: ${((prediction?.confidence || 0) * 100).toFixed(0)}%
- Lambda (xG): ${homeVi} ${prediction?.lambdas?.home ?? 'N/A'}, ${awayVi} ${prediction?.lambdas?.away ?? 'N/A'}

Hãy trả về JSON hợp lệ với định dạng sau (TẤT CẢ bằng tiếng Việt):
{
  "keyFactors": [
    {"factor": "mô tả yếu tố ảnh hưởng bằng tiếng Việt", "impact": "tích cực|tiêu cực|trung lập", "weight": 0.0-1.0}
  ],
  "riskLevel": "thấp|trung bình|cao",
  "recommendation": "nhận định và khuyến nghị bằng tiếng Việt",
  "summary": "2-3 câu phân tích tổng quan bằng tiếng Việt"
}`;
}

/**
 * Tạo cache key từ cặp đội + ngày (YYYY-MM-DD)
 */
function makeCacheKey(homeTeam, awayTeam, matchDate) {
  const d = matchDate ? matchDate.substring(0, 10) : 'nodate';
  return `${homeTeam}__${awayTeam}__${d}`;
}

/**
 * Đọc cache từ DB (TTL: 24h)
 */
async function getCachedAnalysis(cacheKey) {
  try {
    const db = await getDatabase();
    const row = await queryGet(db,
      `SELECT result FROM analysis_cache WHERE cache_key = ? AND created_at > datetime('now', '-30 days')`,
      [cacheKey]
    );
    if (row?.result) {
      console.log(`[Gemini] Cache HIT — ${cacheKey}`);
      return JSON.parse(row.result);
    }
  } catch (_) {}
  return null;
}

/**
 * Lưu kết quả vào cache DB
 */
async function saveToCache(cacheKey, analysis) {
  try {
    const db = await getDatabase();
    await queryRun(db,
      `INSERT OR REPLACE INTO analysis_cache (cache_key, result, created_at)
       VALUES (?, ?, datetime('now'))`,
      [cacheKey, JSON.stringify(analysis)]
    );
    console.log(`[Gemini] Cache SAVED — ${cacheKey}`);
  } catch (err) {
    console.warn('[Gemini] Cache save failed:', err.message);
  }
}

/**
 * Phân tích trận đấu bằng Gemini AI (tiếng Việt)
 * Có cache: nếu đã phân tích cặp đội này trong 24h → trả về ngay, không tốn request
 */
export async function analyzeMatch(context) {
  const apiKey = process.env.CLAUDE_API_KEY;

  // Tạo cache key
  const cacheKey = makeCacheKey(context.homeTeam, context.awayTeam, context.matchDate);

  // Kiểm tra cache trước
  const cached = await getCachedAnalysis(cacheKey);
  if (cached) return cached;

  // Nếu không có API key → fallback tiếng Việt
  if (!apiKey || apiKey === 'your_claude_key_here') {
    console.warn('[Gemini] API key chưa được cấu hình — dùng phân tích tĩnh');
    return getFallbackAnalysis(context);
  }

  try {
    const prompt = buildPrompt(context);

    // Thử các model Gemini, ưu tiên mặc định gemini-3.0-flash hàng đầu, tự động fallback nếu lỗi
    const MODELS = [
      'gemini-3.0-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-2.0-flash-exp'
    ];
    let responseText = '';

    for (const model of MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const resp = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        }, { timeout: 20000 });

        responseText = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (responseText) {
          console.log(`[Gemini] Dùng model: ${model}`);
          break;
        }
      } catch (modelErr) {
        console.warn(`[Gemini] Model ${model} lỗi: ${modelErr.response?.data?.error?.message || modelErr.message}`);
      }
    }

    if (!responseText) throw new Error('Không có phản hồi từ Gemini');

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Không tìm thấy JSON trong phản hồi Gemini');

    const analysis = JSON.parse(jsonMatch[0]);

    // Normalize riskLevel về tiếng Việt
    const riskMap = { 'low': 'thấp', 'medium': 'trung bình', 'high': 'cao' };
    if (riskMap[analysis.riskLevel]) analysis.riskLevel = riskMap[analysis.riskLevel];

    console.log(`[Gemini] Phân tích xong — rủi ro: ${analysis.riskLevel}`);

    // Lưu cache
    await saveToCache(cacheKey, analysis);

    return analysis;
  } catch (err) {
    console.error('[Gemini] analyzeMatch lỗi:', err.response?.data || err.message);
    return getFallbackAnalysis(context);
  }
}

/**
 * Phân tích dự phòng khi không có API key hoặc API lỗi (tiếng Việt)
 */
function getFallbackAnalysis(context) {
  const pred = context.prediction;
  const homeWin = pred?.result?.home || 0.33;
  const draw    = pred?.result?.draw  || 0.33;
  const awayWin = pred?.result?.away  || 0.33;

  const homeVi = toViName(context.homeTeam);
  const awayVi  = toViName(context.awayTeam);

  let riskLevel = 'trung bình';
  if (homeWin > 0.60 || awayWin > 0.60) riskLevel = 'thấp';
  else if (Math.max(homeWin, draw, awayWin) < 0.42) riskLevel = 'cao';

  let favoredResult = 'Hòa';
  if (homeWin > draw && homeWin > awayWin) favoredResult = homeVi + ' thắng';
  else if (awayWin > homeWin && awayWin > draw) favoredResult = awayVi + ' thắng';

  const homePercent = Math.round(homeWin * 100);
  const drawPercent = Math.round(draw * 100);
  const awayPercent = Math.round(awayWin * 100);

  return {
    keyFactors: [
      { factor: 'Lợi thế sân nhà', impact: 'tích cực', weight: 0.7 },
      { factor: 'Phân tích thống kê phong độ gần đây', impact: 'trung lập', weight: 0.5 },
    ],
    riskLevel,
    recommendation: `Theo mô hình thống kê, kết quả khả năng cao nhất là: ${favoredResult}. Xác suất: ${homeVi} thắng ${homePercent}%, Hòa ${drawPercent}%, ${awayVi} thắng ${awayPercent}%.`,
    summary: `Phân tích tự động dựa trên mô hình Bivariate Poisson + Dixon-Coles + ELO. ${favoredResult} được dự báo với xác suất ${Math.round(Math.max(homeWin, draw, awayWin) * 100)}%. Kích hoạt Gemini API để có phân tích chiến thuật và phong độ sâu hơn.`,
  };
}

function getTextHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return 'h' + Math.abs(hash);
}

export async function analyzeInjuriesAndContextWithAI(injuriesText, homeTeam, awayTeam, bypassCache = false) {
  const apiKey = process.env.CLAUDE_API_KEY;
  const hash = getTextHash(injuriesText);
  const cacheKey = makeCacheKey(homeTeam, awayTeam, 'context__' + hash);

  // Thử đọc cache trước
  if (!bypassCache) {
    const cached = await getCachedAnalysis(cacheKey);
    if (cached) return cached;
  }

  const defaultResult = {
    homeAttackPenalty: 0.0,
    awayAttackPenalty: 0.0,
    homeDefensePenalty: 0.0,
    awayDefensePenalty: 0.0,
    homeMotivation: 1.0,
    awayMotivation: 1.0,
    reasoning: 'Không có phân tích ngữ cảnh (dùng giá trị mặc định)'
  };

  if (!apiKey || apiKey === 'your_claude_key_here') {
    return defaultResult;
  }

  const homeVi = toViName(homeTeam);
  const awayVi = toViName(awayTeam);

  const prompt = `Bạn là chuyên gia định lượng bóng đá hàng đầu. Hãy phân tích đoạn thông tin chấn thương, treo giò hoặc tin tức trước trận đấu sau đây của hai đội và quy đổi nó thành các chỉ số ảnh hưởng sức mạnh tấn công, phòng ngự và động lực thi đấu của hai đội.

Trận đấu: ${homeVi} (Đội nhà) vs ${awayVi} (Đội khách)
Văn bản tin tức: "${injuriesText}"

Nhiệm vụ của bạn là đánh giá:
1. Mức độ thiệt hại của hàng TẤN CÔNG đội nhà (homeAttackPenalty) và đội khách (awayAttackPenalty): giá trị từ 0.0 (không ảnh hưởng) đến 0.60 (suy yếu nghiêm trọng, mất toàn bộ trụ cột ghi bàn).
2. Mức độ thiệt hại của hàng PHÒNG NGỰ/Thủ môn đội nhà (homeDefensePenalty) và đội khách (awayDefensePenalty): giá trị từ 0.0 đến 0.40 (mất thủ môn chính hoặc trung vệ trụ cột).
3. Hệ số ĐỘNG LỰC thi đấu/tâm lý đội nhà (homeMotivation) và đội khách (awayMotivation): giá trị từ 0.80 (mất tinh thần, mâu thuẫn nội bộ) đến 1.20 (động lực cực cao, thay tướng đổi vận, derby thù địch, đua vô địch). Bình thường là 1.0.

Hãy phân tích cực kỳ thực tế dựa trên vai trò của các cầu thủ được nhắc đến (ví dụ: Mbappe là siêu sao tấn công quan trọng bậc nhất -> phạt tấn công Pháp 0.40; Bellingham vắng mặt -> phạt tấn công Anh 0.25; Van Dijk vắng mặt -> phạt phòng ngự Hà Lan 0.25).

Hãy trả về JSON hợp lệ có định dạng sau (chỉ trả về JSON, không thêm văn bản giải thích nào khác):
{
  "homeAttackPenalty": 0.0,
  "awayAttackPenalty": 0.0,
  "homeDefensePenalty": 0.0,
  "awayDefensePenalty": 0.0,
  "homeMotivation": 1.0,
  "awayMotivation": 1.0,
  "reasoning": "Mô tả ngắn gọn lập luận phân tích bằng tiếng Việt"
}`;

  try {
    const MODELS = [
      'gemini-3.0-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ];
    let responseText = '';

    for (const model of MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const resp = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        }, { timeout: 20000 });

        responseText = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (responseText) {
          console.log(`[Gemini/Context] Dùng model: ${model}`);
          break;
        }
      } catch (modelErr) {
        console.warn(`[Gemini/Context] Model ${model} lỗi: ${modelErr.message}`);
      }
    }

    if (!responseText) throw new Error('Không nhận được phản hồi từ Gemini');

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Không tìm thấy JSON trong phản hồi');

    const result = JSON.parse(jsonMatch[0]);
    
    const finalResult = {
      homeAttackPenalty: Math.max(0.0, Math.min(0.60, parseFloat(result.homeAttackPenalty) || 0)),
      awayAttackPenalty: Math.max(0.0, Math.min(0.60, parseFloat(result.awayAttackPenalty) || 0)),
      homeDefensePenalty: Math.max(0.0, Math.min(0.40, parseFloat(result.homeDefensePenalty) || 0)),
      awayDefensePenalty: Math.max(0.0, Math.min(0.40, parseFloat(result.awayDefensePenalty) || 0)),
      homeMotivation: Math.max(0.70, Math.min(1.30, parseFloat(result.homeMotivation) || 1.0)),
      awayMotivation: Math.max(0.70, Math.min(1.30, parseFloat(result.awayMotivation) || 1.0)),
      reasoning: result.reasoning || 'Không có lý giải'
    };

    await saveToCache(cacheKey, finalResult);
    return finalResult;
  } catch (err) {
    console.error('[Gemini/Context] Lỗi phân tích ngữ cảnh tin tức:', err.message);
    return defaultResult;
  }
}

export async function analyzeLineupsWithAI(homeLineup, awayLineup, homeTeam, awayTeam, bypassCache = false) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!homeLineup && !awayLineup) {
    return {
      homeAttackPenalty: 0.0,
      awayAttackPenalty: 0.0,
      homeDefensePenalty: 0.0,
      awayDefensePenalty: 0.0,
      homeMotivation: 1.0,
      awayMotivation: 1.0,
      tacticsReasoning: ''
    };
  }

  const hash = getTextHash((homeLineup || '') + '##' + (awayLineup || ''));
  const cacheKey = makeCacheKey(homeTeam, awayTeam, 'lineups__' + hash);

  if (!bypassCache) {
    const cached = await getCachedAnalysis(cacheKey);
    if (cached) return cached;
  }

  const defaultResult = {
    homeAttackPenalty: 0.0,
    awayAttackPenalty: 0.0,
    homeDefensePenalty: 0.0,
    awayDefensePenalty: 0.0,
    homeMotivation: 1.0,
    awayMotivation: 1.0,
    tacticsReasoning: 'Không có phân tích đội hình ra sân (dùng mặc định)'
  };

  if (!apiKey || apiKey === 'your_claude_key_here') {
    return defaultResult;
  }

  const homeVi = toViName(homeTeam);
  const awayVi = toViName(awayTeam);

  const prompt = `Bạn là chuyên gia phân tích chiến thuật bóng đá hàng đầu. Hãy phân tích đội hình ra sân chính thức (hoặc dự kiến) dưới đây của hai đội và đánh giá xem đội hình này có những thay đổi gì lớn so với đội hình mạnh nhất, cũng như xu hướng chiến thuật sẽ thế nào. Sau đó quy đổi ảnh hưởng của đội hình này thành các chỉ số phạt tấn công, phòng ngự và động lực thi đấu:

Trận đấu: ${homeVi} (Đội nhà) vs ${awayVi} (Đội khách)

Đội hình ${homeVi}: "${homeLineup || 'Chưa cung cấp'}"
Đội hình ${awayVi}: "${awayLineup || 'Chưa cung cấp'}"

Hãy thực hiện nhiệm vụ:
1. Mức độ thiệt hại của hàng TẤN CÔNG đội nhà (homeAttackPenalty) và đội khách (awayAttackPenalty): giá trị từ 0.0 (không ảnh hưởng) đến 0.50 (suy yếu nghiêm trọng, cất hoặc thiếu vắng siêu sao tấn công chủ lực).
2. Mức độ thiệt hại của hàng PHÒNG NGỰ/Thủ môn đội nhà (homeDefensePenalty) và đội khách (awayDefensePenalty): giá trị từ 0.0 đến 0.35 (mất thủ môn chính hoặc trung vệ trụ cột).
3. Hệ số ĐỘNG LỰC thi đấu/tâm lý đội nhà (homeMotivation) và đội khách (awayMotivation): giá trị từ 0.85 (tâm lý yếu, buông xuôi, xoay tua giữ sức đội hình phụ) đến 1.15 (tinh thần cực kỳ hưng phấn, tung đội hình tối ưu quyết đấu tử chiến). Bình thường là 1.0.
4. Cung cấp một đoạn phân tích chiến thuật ngắn gọn (tối đa 150 từ) bằng tiếng Việt (tacticsReasoning).

Hãy trả về JSON hợp lệ có định dạng sau:
{
  "homeAttackPenalty": 0.0,
  "awayAttackPenalty": 0.0,
  "homeDefensePenalty": 0.0,
  "awayDefensePenalty": 0.0,
  "homeMotivation": 1.0,
  "awayMotivation": 1.0,
  "tacticsReasoning": "Mô tả phân tích chiến thuật ngắn gọn bằng tiếng Việt"
}`;

  try {
    const MODELS = [
      'gemini-3.0-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ];
    let responseText = '';

    for (const model of MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const resp = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        }, { timeout: 20000 });

        responseText = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (responseText) {
          console.log(`[Gemini/Lineup] Dùng model: ${model}`);
          break;
        }
      } catch (modelErr) {
        console.warn(`[Gemini/Lineup] Model ${model} lỗi: ${modelErr.message}`);
      }
    }

    if (!responseText) throw new Error('Không nhận được phản hồi từ Gemini');

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Không tìm thấy JSON trong phản hồi');

    const result = JSON.parse(jsonMatch[0]);
    
    const finalResult = {
      homeAttackPenalty: Math.max(0.0, Math.min(0.50, parseFloat(result.homeAttackPenalty) || 0)),
      awayAttackPenalty: Math.max(0.0, Math.min(0.50, parseFloat(result.awayAttackPenalty) || 0)),
      homeDefensePenalty: Math.max(0.0, Math.min(0.35, parseFloat(result.homeDefensePenalty) || 0)),
      awayDefensePenalty: Math.max(0.0, Math.min(0.35, parseFloat(result.awayDefensePenalty) || 0)),
      homeMotivation: Math.max(0.70, Math.min(1.30, parseFloat(result.homeMotivation) || 1.0)),
      awayMotivation: Math.max(0.70, Math.min(1.30, parseFloat(result.awayMotivation) || 1.0)),
      tacticsReasoning: result.tacticsReasoning || 'Không có lý giải chiến thuật'
    };

    await saveToCache(cacheKey, finalResult);
    return finalResult;
  } catch (err) {
    console.error('[Gemini/Lineup] Lỗi phân tích đội hình ra sân:', err.message);
    return defaultResult;
  }
}


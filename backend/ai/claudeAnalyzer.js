/**
 * Claude AI Analyzer
 * Provides contextual analysis of match factors using Anthropic's Claude API
 */

import Anthropic from '@anthropic-ai/sdk';

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  }
  return client;
}

/**
 * Build the analysis prompt for Claude
 */
function buildPrompt(context) {
  const {
    homeTeam,
    awayTeam,
    league,
    homeForm,
    awayForm,
    h2h,
    injuries,
    situationalFactors,
    prediction,
  } = context;

  return `You are an expert football analyst. Analyze this upcoming match and provide insights.

**Match**: ${homeTeam} vs ${awayTeam} (${league || 'Unknown League'})

**Current Form (last 5)**:
- ${homeTeam}: ${homeForm || 'N/A'}
- ${awayTeam}: ${awayForm || 'N/A'}

**Head-to-Head**: ${h2h || 'No recent H2H data'}

**Injuries/Suspensions**: ${injuries || 'None known'}

**Situational Factors**: ${JSON.stringify(situationalFactors || {})}

**Statistical Prediction**:
- Predicted score: ${prediction?.score ? `${prediction.score.home}-${prediction.score.away}` : 'N/A'}
- Win probabilities: Home ${((prediction?.result?.home || 0) * 100).toFixed(0)}%, Draw ${((prediction?.result?.draw || 0) * 100).toFixed(0)}%, Away ${((prediction?.result?.away || 0) * 100).toFixed(0)}%
- Confidence: ${((prediction?.confidence || 0) * 100).toFixed(0)}%

Please respond ONLY with valid JSON in this exact format:
{
  "keyFactors": [
    {"factor": "string describing the factor", "impact": "positive/negative/neutral", "weight": 0.0-1.0}
  ],
  "riskLevel": "low|medium|high",
  "recommendation": "string with betting/prediction recommendation",
  "summary": "2-3 sentence match analysis"
}`;
}

/**
 * Analyze match context using Claude AI
 * @param {object} context - match context object
 * @returns {Promise<object>} - { keyFactors, riskLevel, recommendation, summary }
 */
export async function analyzeMatch(context) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey === 'your_claude_key_here') {
    console.warn('[Claude] API key not set — returning fallback analysis');
    return getFallbackAnalysis(context);
  }

  try {
    const anthropic = getClient();
    const prompt = buildPrompt(context);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0]?.text || '';

    // Extract JSON from response (may be wrapped in markdown)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in Claude response');
    }

    const analysis = JSON.parse(jsonMatch[0]);
    console.log(`[Claude] Analysis complete — risk: ${analysis.riskLevel}`);
    return analysis;
  } catch (err) {
    console.error('[Claude] analyzeMatch error:', err.message);
    return getFallbackAnalysis(context);
  }
}

/**
 * Fallback analysis when Claude API is unavailable
 */
function getFallbackAnalysis(context) {
  const pred = context.prediction;
  const homeWinProb = pred?.result?.home || 0.33;
  const drawProb = pred?.result?.draw || 0.33;
  const awayWinProb = pred?.result?.away || 0.33;

  const riskLevel = homeWinProb > 0.6 ? 'low' : homeWinProb > 0.45 ? 'medium' : 'high';

  let favoredResult = 'a draw';
  if (homeWinProb > drawProb && homeWinProb > awayWinProb) {
    favoredResult = context.homeTeam;
  } else if (awayWinProb > homeWinProb && awayWinProb > drawProb) {
    favoredResult = context.awayTeam;
  }

  return {
    keyFactors: [
      { factor: 'Home advantage', impact: 'positive', weight: 0.7 },
      { factor: 'Statistical form analysis', impact: 'neutral', weight: 0.5 },
    ],
    riskLevel,
    recommendation: `Based on statistical models, the prediction favors ${favoredResult}.`,
    summary: `This analysis is generated from statistical models only. Enable Claude API for deeper contextual analysis including injury impact, tactical matchups, and recent form trends.`,
  };
}

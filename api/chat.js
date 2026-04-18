const axios = require('axios');

const NIM_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  'kimi-k2-thinking': 'moonshotai/kimi-k2-thinking',
  'glm-4.7': 'z-ai/glm4_7',
  'kimi-k2.5': 'moonshotai/kimi-k2.5',
  'deepseek-v3.2': 'deepseek-ai/deepseek-v3_2',
  'kimi-k2-instruct': 'moonshotai/kimi-k2-instruct-0905b'

};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Health check
  if (req.method === 'GET') {
    return res.json({ status: 'ok', service: 'OpenAI to NVIDIA NIM Proxy' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // Model mapping with fallback
    let nimModel = MODEL_MAPPING[model];
    if (!nimModel) {
      const m = model.toLowerCase();
      if (m.includes('gpt-4') || m.includes('claude-opus')) {
        nimModel = 'meta/llama-3.1-405b-instruct';
      } else if (m.includes('claude') || m.includes('gemini') || m.includes('70b')) {
        nimModel = 'meta/llama-3.1-70b-instruct';
      } else {
        nimModel = 'meta/llama-3.1-8b-instruct';
      }
    }

    const nimRequest = {
      model: nimModel,
      messages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 9024,
      stream: false // Vercel serverless doesn't support streaming well
    };

    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // Return OpenAI-compatible response
    return res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: response.data.choices.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          content: choice.message.content || ''
        },
        finish_reason: choice.finish_reason
      })),
      usage: response.data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });

  } catch (error) {
    console.error('Proxy error:', error.message);
    return res.status(error.response?.status || 500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'invalid_request_error'
      }
    });
  }
}

const axios = require('axios');

const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  'kimi-k2-thinking': 'moonshotai/kimi-k2-thinking',
  'glm-4.7': 'z-ai/glm4_7',
  'kimi-k2.5': 'moonshotai/kimi-k2.5',
  'deepseek-v3.2': 'deepseek-ai/deepseek-v3.2',
  'kimi-k2-instruct': 'moonshotai/kimi-k2-instruct-0905b'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Debug endpoint - visit /v1/chat/completions?debug=1 in browser
  if (req.method === 'GET' && req.query.debug) {
    try {
      const testModel = req.query.model || 'meta/llama-3.1-8b-instruct';
      const testResponse = await axios.post(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        {
          model: testModel,
          messages: [{ role: 'user', content: 'say hi' }],
          max_tokens: 10
        },
        {
          headers: {
            'Authorization': `Bearer ${NIM_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return res.json({
        success: true,
        api_key_set: !!NIM_API_KEY,
        api_key_prefix: NIM_API_KEY ? NIM_API_KEY.substring(0, 8) + '...' : 'NOT SET',
        nvidia_response: testResponse.data
      });
    } catch (err) {
      return res.json({
        success: false,
        api_key_set: !!NIM_API_KEY,
        api_key_prefix: NIM_API_KEY ? NIM_API_KEY.substring(0, 8) + '...' : 'NOT SET',
        error: err.message,
        nvidia_status: err.response?.status,
        nvidia_detail: err.response?.data
      });
    }
  }

  if (req.method === 'GET') {
    return res.json({ status: 'ok', service: 'OpenAI to NVIDIA NIM Proxy' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    const { model, messages, temperature, max_tokens } = req.body;

    const nimModel = MODEL_MAPPING[model] || 'deepseek-ai/deepseek-v3_2';

    const response = await axios.post(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        model: nimModel,
        messages,
        temperature: temperature || 0.6,
        max_tokens: max_tokens || 9024,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

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
    return res.status(error.response?.status || 500).json({
      error: {
        message: error.message,
        type: 'invalid_request_error',
        nvidia_detail: error.response?.data || 'no detail',
        nvidia_status: error.response?.status || 'unknown'
      }
    });
  }
}

const axios = require('axios');
const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  'nemotron2': 'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nemotron1': 'nvidia/nemotron-3-ultra-550b-a55b',
  'kimi-k2.6': 'moonshotai/kimi-k2.6',
  'glm-5.2': 'z-ai/glm-5.2',
  'deepseek-v4-pro': 'deepseek-ai/deepseek-v4-pro',
  'deepseek-v4-flash': 'deepseek-ai/deepseek-v4-flash'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Debug endpoint
  if (req.method === 'GET' && req.query.debug) {
    try {
      const testModel = req.query.model || 'deepseek-ai/deepseek-v4-flash';
      const testResponse = await axios.post(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        { model: testModel, messages: [{ role: 'user', content: 'say hi' }], max_tokens: 10 },
        { headers: { 'Authorization': `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' } }
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
    const { model, messages, temperature, max_tokens, stream } = req.body;
    const nimModel = MODEL_MAPPING[model] || 'deepseek-ai/deepseek-v4-flash';
    const shouldStream = stream === true || stream === 'true';

    if (shouldStream) {
      // Set SSE headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const nimResponse = await axios.post(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        {
          model: nimModel,
          messages,
          temperature: temperature || 0.6,
          max_tokens: max_tokens || 9024,
          stream: true
        },
        {
          headers: {
            'Authorization': `Bearer ${NIM_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'stream'
        }
      );

      let buffer = '';

      nimResponse.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Forward [DONE] signal
          if (trimmed === 'data: [DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));

              // Strip reasoning_content, keep only content
              if (parsed.choices?.[0]?.delta) {
                const delta = parsed.choices[0].delta;
                if (delta.reasoning_content !== undefined) {
                  delete delta.reasoning_content;
                }
                // Ensure content field exists
                if (delta.content === undefined) {
                  delta.content = '';
                }
              }

              // Rewrite model name to match what Janitor AI sent
              if (parsed.model) parsed.model = model;

              res.write(`data: ${JSON.stringify(parsed)}\n\n`);
            } catch {
              // Forward unparseable lines as-is
              res.write(trimmed + '\n\n');
            }
          }
        }
      });

      nimResponse.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      nimResponse.data.on('error', (err) => {
        console.error('Stream error:', err.message);
        res.end();
      });

    } else {
      // Non-streaming response
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
    }

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

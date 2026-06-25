export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 });
  }

  const { type, text, image, mediaType } = await req.json();

  const systemContent = `你是陈氏医疗顾问的AI助手，擅长用通俗易懂的中文向普通患者解释医疗报告。
请分析报告并严格以JSON格式返回，格式如下：
{"risk_level":"高/中/低","summary":"1-2句话总结核心发现","findings":["发现1","发现2","发现3"],"questions":["建议问医生的问题1","问题2","问题3"],"next_steps":"建议的下一步行动"}
要求：通俗易懂，语气温和，只返回JSON，不要任何其他内容。`;

  const userContent = type === 'image'
    ? [
        { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } },
        { type: "text", text: "请分析这张医疗报告图片，按要求返回JSON。" }
      ]
    : `请分析以下医疗报告内容：\n\n${text}`;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent }
        ],
        max_tokens: 1000,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || '请求失败' }), { status: 500 });
    }

    const resultText = data.choices[0].message.content.replace(/```json|```/g, '').trim();
    const result = JSON.parse(resultText);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

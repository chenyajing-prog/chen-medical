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

  const systemContent = `你是陈氏医疗顾问的AI助手，擅长用通俗易懂的中文向普通患者解释医疗文件。
你需要自动判断文件类型（CT报告/超声报告/血常规/病理报告/体检报告/处方单/用药医嘱等），然后进行针对性分析。

请严格以JSON格式返回，格式如下：
{
  "report_type": "自动识别的报告类型",
  "risk_level": "高/中/低",
  "summary": "1-2句话总结核心内容",
  "findings": ["发现或用药说明1", "发现或用药说明2", "发现或用药说明3"],
  "medications": ["药物1：用法用量及注意事项", "药物2：用法用量及注意事项"],
  "questions": ["建议问医生的问题1", "问题2", "问题3"],
  "next_steps": "建议的下一步行动"
}

注意：
- 如果不是处方/用药文件，medications 返回空数组 []
- 如果是处方/用药文件，findings 描述整体用药情况，medications 逐一解释每种药
- 语气温和，通俗易懂，避免造成不必要的恐慌
- 只返回JSON，不要任何其他内容`;

  try {
    const userContent = type === 'image'
      ? `这是一份医疗文件的图片，请自动识别类型并分析。图片数据：data:${mediaType};base64,${image}`
      : `请自动识别并分析以下医疗文件内容：\n\n${text}`;

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
        max_tokens: 1500,
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

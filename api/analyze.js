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

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const { type, text, image, mediaType } = await req.json();

  const systemContent = `你是陈氏医疗顾问的AI助手，是一位经验丰富的全科医生，擅长用通俗易懂的中文向普通患者解释医疗文件。

你的任务不只是翻译报告，而是像一个真正懂医的家人一样，帮患者理解报告背后的含义。

请自动判断文件类型，然后严格以JSON格式返回：
{
  "report_type": "报告类型",
  "risk_level": "高/中/低",
  "summary": "用大白话说：这份报告最重要的发现是什么，患者最需要知道什么",
  "findings": [
    "【发现】具体数值或描述 → 【解释】这意味着什么（用大白话）→ 【提示】需要注意或排除什么"
  ],
  "medications": ["药物1：作用、用法用量、注意事项、常见副作用"],
  "questions": ["结合报告内容，患者最应该问医生的问题"],
  "next_steps": "具体建议：需要做什么检查、看什么科、多久复查"
}

重要原则：
- 对每个异常发现，结合患者年龄、性别、临床背景进行推断
- 说明该异常"最可能是什么"、"需要排除什么严重情况"
- 所有具体数值（大小、厚度、浓度）必须保留，并注明是否在正常范围
- 语气像关心患者的家庭医生，温和但不回避重要信息
- 只返回JSON，不要任何其他内容`;

  try {
    let result;

    if (type === 'image') {
      // 图片模式：用 OpenAI GPT-4o
      if (!openaiKey) {
        return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), { status: 500 });
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemContent },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mediaType};base64,${image}`,
                    detail: 'high'
                  }
                },
                {
                  type: 'text',
                  text: '请分析这张医疗文件图片，按要求返回JSON。'
                }
              ]
            }
          ],
          max_tokens: 1500,
          temperature: 0.3,
          response_format: { type: 'json_object' }
        })
      });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.error?.message || 'OpenAI请求失败' }), { status: 500 });
      }
      const resultText = data.choices[0].message.content.replace(/```json|```/g, '').trim();
      result = JSON.parse(resultText);

    } else {
      // 文字模式：用 DeepSeek
      if (!deepseekKey) {
        return new Response(JSON.stringify({ error: 'DeepSeek API key not configured' }), { status: 500 });
      }

      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: `请分析以下医疗文件内容：\n\n${text}` }
          ],
          max_tokens: 1500,
          temperature: 0.3,
          response_format: { type: 'json_object' }
        })
      });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.error?.message || 'DeepSeek请求失败' }), { status: 500 });
      }
      const resultText = data.choices[0].message.content.replace(/```json|```/g, '').trim();
      result = JSON.parse(resultText);
    }

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

# 乔木语音 Qiaomu Audio

在任意 Obsidian 笔记里点一下就朗读；按一下麦克风说话，文字自动写进笔记。

Read any Obsidian note aloud with one click, and dictate speech straight into your notes.

[官方目录](https://community.obsidian.md/plugins/qiaomu-audio) · [下载发布版](https://github.com/joeseesun/qiaomu-audio/releases/latest) · [反馈问题](https://github.com/joeseesun/qiaomu-audio/issues)

## 安装

1.0.1 已完成官方自动扫描并公开目录网页。客户端索引同步后，可在第三方插件中搜索 **Qiaomu Audio**，或在官方页面点击 **Add to Obsidian**；当前索引验收结果见[发布记录](docs/release-evidence-1.0.1.md)。手动安装时，把发布页的 `main.js`、`manifest.json` 和 `styles.css` 放进 `<笔记库>/.obsidian/plugins/qiaomu-audio/`，然后启用插件。

## 朗读

- 每篇笔记右上角有 🔊 按钮：有选中文字就读选中部分，否则从光标处读（阅读视图从当前屏幕开始）。
- 底部出现播放条：播放/暂停、上一句/下一句、倍速、音色。编辑模式中正在读的句子会高亮；阅读视图会跟随对应文字滚动。手动滚动后会出现「回到朗读处」。
- 会跳过属性区、代码块、公式、注释、嵌入和网址；链接只读显示文字。
- 语音服务：Edge（默认，无需密钥，仅桌面端）、系统语音、Mac 本机语音、本机模型（Kokoro / MeloTTS，离线）、OpenAI 及兼容接口、通义千问、豆包、MiniMax、硅基流动、ElevenLabs、Azure。
- 已在乔木 Reader 里配置过朗读，可以在设置里一键导入（含密钥）；Reader 已下载的本机模型会直接复用。

## 语音转文字（听写）

- 每篇笔记右上角有 🎙 按钮，或用命令「开始或结束听写」。说完点「完成」，文字插在光标处；Esc 取消。
- **本机转写（桌面端）**：SenseVoice Small，先在插件外[安装本机环境](docs/local-runtime.md)，再在设置中下载约 156 MB 模型；之后不上传、不花钱，支持中、英、日、韩、粤语。
- **云端服务**：硅基流动 Qwen3-ASR、豆包极速版、智谱 GLM、阶跃星辰、小米 MiMo、Groq、OpenAI，以及本机/自定义 OpenAI 兼容服务。可保存多个服务随时切换，手机端也能用。
- 出字方式：「说完再出字」（整段识别，最稳）或「边说边出字」（每次停顿后识别一句）。
- 可选「保留录音」：录音存进附件文件夹并嵌入在文字下方。转写失败时可以重新转写或保存录音，不会丢掉刚说的话。

## 隐私

- 密钥保存在 Obsidian 的钥匙串（SecretStorage），不写进 `data.json`。
- 本机朗读与本机转写：文字和音频不离开这台电脑。模型与运行环境存放在系统应用数据目录（macOS：`~/Library/Application Support/qiaomu-audio/speech`），不在笔记库里。
- 云端服务：只发送给你在设置里选的那个服务，按它的规则计费。Edge 朗读会把朗读文字发送给微软。
- 各具名云端服务都有可点击的「获取密钥」「开通与使用说明」。密钥默认隐藏，可临时显示；修改配置后需重新测试，取消测试和迟到结果不会显示连接成功。ASR 密钥按服务商隔离保存。
- 本机环境由独立工具在 Obsidian 外安装，插件只下载模型数据，不安装可执行依赖；具体下载来源与存储见[环境指引](docs/local-runtime.md)。关于页的关注与支持图片仅在打开时从 `radio.qiaomu.ai` 加载。

## 给其他插件

```js
const audio = app.plugins.plugins['qiaomu-audio']?.api;
await audio?.speak('你好');                 // 用设置里的音色朗读，读完后返回
const text = await audio?.transcribe(blob); // Blob / ArrayBuffer / Float32Array → 文字
audio?.startDictation();                    // 在当前笔记开始听写
```

## 开发

```bash
npm install
npm run check
```

`npm run check` 依次运行翻译检查、lint、测试（Node + Python）和构建。`node scripts/e2e-local-asr.mjs` 会真实下载并验证本机转写模型（需要联网，不在常规测试里）。

## 来源与许可

- 项目许可：GPL-3.0-only。朗读部分改编自乔木 Reader（GPL-3.0）；云端识别服务列表与协议改编自乔木 Clipper（MIT）。
- Edge 朗读协议互通参考 rany2/edge-tts（LGPL-3.0），见 `licenses/edge-tts-LGPL.txt`。
- 本机模型在首次使用时从上游固定版本下载并校验 SHA-256，不随插件分发：Kokoro（Apache-2.0）、MeloTTS（MIT）、SenseVoice Small（FunASR Model License），运行时为 sherpa-onnx（Apache-2.0）。

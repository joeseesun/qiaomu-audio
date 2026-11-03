# Mac 本机识别与系统声音转写

这项能力整合到乔木语音现有听写中。Apple 本机识别需要 macOS 26 和可用的 SpeechTranscriber 语言模型。系统声音采集需要 macOS 14.4，可搭配 Apple、SenseVoice 或已有云端识别服务；Windows、Linux 和手机继续使用原有听写能力。

## 使用

1. 安装独立的 **Qiaomu Audio Helper.app** 到应用程序目录。本次开发版本已在开发者的 Mac 上安装；尚未发布签名公证安装包。
2. 在乔木语音的听写设置选择 **Apple 本机识别**，选择录音语言，点击「检查是否可用」。需要模型时点击「准备本机模型」，由 Apple 下载该语言资源；取消或关闭设置会停止这次准备操作。暂不自动检测语言，「自动」暂按中文处理。
3. 麦克风听写仍使用原来的麦克风按钮。转写电脑播放的声音时，在笔记右键菜单或命令面板选择「开始或结束系统声音转写」，再次执行结束，Escape 取消。
4. 原有「边说边出字 / 说完再识别」及保留录音选项同样适用。文字写到开始时的光标位置，录音按附件设置保存为 WAV。取消不再接收迟到的转写结果，已经插入的文字保留。

首次采集需要系统声音录制权限。被拒绝时，请到系统设置的「隐私与安全性」允许乔木语音组件，再开始一次。组件只读取声音，不采集屏幕，不更换系统麦克风，也不安装虚拟音频驱动。系统声音会包括同时播放的其他应用，使用前关闭不想录入的声音。

## Ming 云端转写

在「添加转写服务」选择 **蚂蚁百灵 Ming**，填写 Ling 平台 API Key，再测试连接。默认模型 `Ming-3.0-audio-flash`；使用官方 `audio_url` 请求格式，要求仅逐字转写、不回答录音中的问题，不进行翻译。音频发送到该服务，密钥仍保存在 Obsidian SecretStorage。切块串行处理，截断的模型回复不会当作完整文字稿接受。未配置真实 Key 时，协议测试不能代表真实账号可用。

## 本机数据与生命周期

插件不会下载、编译、安装或更新可执行代码。组件通过固定应用程序路径启动，使用参数数组和私有 stdin/stdout 管道，不运行 shell、不开放 HTTP 端口。转写临时 WAV 以 0600 权限创建在本次独占临时目录，成功、失败和取消后删除；录音缓冲只留在本次操作内存中，选择保留时才写入笔记附件。Apple 模型和系统声音在本机处理；选择云服务会把录音发送给所选服务。

停止、取消和卸载插件会关闭组件输入并结束本次子进程；父进程退出时组件也会因 stdin 关闭停止。当前内存录音不提供应用崩溃恢复，不应把它当作长会议的唯一录音备份。

## 开发与来源

```sh
scripts/build-apple-helper.sh          # 使用 Xcode / Command Line Tools 编译和本地签名
scripts/build-apple-helper.sh --install
npm run check
OBSIDIAN_EXE=/Applications/Obsidian.app/Contents/MacOS/Obsidian node scripts/qa-apple-host.mjs
```

插件主包保持原有 GPL-3.0-only。`native/apple/SystemAudioTap.swift` 改编自 [wquguru/cicada](https://github.com/wquguru/cicada/tree/38771f1a5ae691c848ea429f4a870defd92d9d26)，Apache-2.0，保留[原许可证](../licenses/cicada-Apache-2.0.txt)。采集代码从 Cicada 的音频处理链中拆出，作为独立组件复用；Apple 文件识别与 JS 桥接在本项目实现。没有复制 Cicada 的声音克隆模型，也没有打包 BlackHole。

官方依据：[Apple SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer)、[Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)、[Ming 音频理解协议](https://developer.ant-ling.com/en/docs/tutorials/multimodal-understanding/)。核对日期：2026-11-04。

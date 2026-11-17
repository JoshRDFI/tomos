// TEMPORARY (plan Task 1): device test of DownloadManager resume against
// Hugging Face's CDN. Removed in Task 6.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import * as downloader from '@/lib/downloader';

const URL = 'https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf';
let spikeId: number | null = null;

export default function SpikeDownload() {
  const [info, setInfo] = useState('');
  const [id, setId] = useState<number | null>(spikeId);

  useEffect(() => {
    if (id == null) return;
    const t = setInterval(async () => {
      try {
        const [d] = await downloader.query([id]);
        setInfo(`${d.status}${d.reason != null ? ` (reason ${d.reason})` : ''}: ${(d.bytesSoFar / 1e6).toFixed(0)} / ${(d.totalBytes / 1e6).toFixed(0)} MB${d.localPath ? `\n${d.localPath}` : ''}`);
      } catch (e) {
        setInfo(String(e));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [id]);

  if (!downloader.isSupported()) return null;
  return (
    <View style={{ gap: 6, padding: 12, borderWidth: 1, borderRadius: 12, borderStyle: 'dashed' }}>
      <Text>Download test (Qwen3-8B Q4_K_M, 5,027,784,512 bytes, Wi-Fi only)</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button mode="outlined" disabled={id != null} onPress={async () => {
          try {
            spikeId = await downloader.enqueue({ url: URL, relativePath: 'models/spike/Qwen3-8B-Q4_K_M.gguf', title: 'Qwen3-8B-Q4_K_M.gguf (test)', wifiOnly: true });
            setId(spikeId);
          } catch (e) { setInfo(String(e)); }
        }}>Test HF download</Button>
        <Button mode="outlined" disabled={id == null} onPress={async () => {
          if (id != null) await downloader.remove([id]);
          spikeId = null; setId(null); setInfo('removed');
        }}>Remove</Button>
      </View>
      {!!info && <Text selectable>{info}</Text>}
    </View>
  );
}

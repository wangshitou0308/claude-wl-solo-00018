import { useEffect, useState } from 'react';
import type { CredentialImage, SourceId } from '../types';
import { deleteImage, getImage, putImage } from '../lib/db';
import { SOURCE_LABELS } from '../lib/compare';

interface ImagePanelProps {
  source: SourceId;
  images: CredentialImage[];
  onAddMeta: (image: CredentialImage) => void;
  onRemoveMeta: (id: string) => void;
  notify: (msg: string) => void;
}

interface Tile {
  meta: CredentialImage
  url: string;
}

export function ImagePanel({ source, images, onAddMeta, onRemoveMeta, notify }: ImagePanelProps) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [lightbox, setLightbox] = useState<{ url: string; name: string; zoom: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    Promise.all(
      images
        .filter((m) => m.source === source)
        .map(async (meta) => {
          const stored = await getImage(meta.id);
          if (!stored) return null;
          const url = URL.createObjectURL(stored.blob);
          urls.push(url);
          return { meta, url };
        }),
    ).then((rows) => {
      if (cancelled) {
        urls.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setTiles(rows.filter((r): r is Tile => r !== null));
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [images, source]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!lightbox) return;
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === '+' || e.key === '=') setLightbox((l) => (l ? { ...l, zoom: Math.min(5, l.zoom + 0.25) } : l));
      if (e.key === '-') setLightbox((l) => (l ? { ...l, zoom: Math.max(0.5, l.zoom - 0.25) } : l));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        notify('只能添加图片文件');
        continue;
      }
      const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await putImage(id, file);
      onAddMeta({
        id,
        source,
        name: file.name || '凭据照片',
        type: file.type,
        createdAt: Date.now(),
      });
    }
    notify(`已保存到本机浏览器：${SOURCE_LABELS[source]}凭据`);
  };

  const remove = async (id: string) => {
    await deleteImage(id);
    onRemoveMeta(id);
    notify('凭据图片已删除');
  };

  return (
    <div>
      <div className="toolbar">
        <label className="inline" style={{ margin: 0 }}>
          <button
            type="button"
            className="primary"
            onClick={() => document.getElementById(`file-${source}`)?.click()}
          >
            📷 添加 / 拍摄凭据照片
          </button>
          <input
            id={`file-${source}`}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <span className="small muted">图片只存在本机浏览器（IndexedDB），不会上传。</span>
      </div>

      {tiles.length === 0 ? (
        <p className="small muted">还没有凭据图片。可拍下处方、加工单或镜袋包装，放大后照着抄录。</p>
      ) : (
        <div className="img-grid">
          {tiles.map((t) => (
            <div className="img-tile" key={t.meta.id}>
              <img
                src={t.url}
                alt={t.meta.name}
                onClick={() => setLightbox({ url: t.url, name: t.meta.name, zoom: 1 })}
              />
              <div className="meta" title={t.meta.name}>
                {t.meta.name}
                <div className="small muted">{new Date(t.meta.createdAt).toLocaleString()}</div>
              </div>
              <div className="row">
                <button type="button" onClick={() => setLightbox({ url: t.url, name: t.meta.name, zoom: 1 })}>
                  放大
                </button>
                <button type="button" className="danger" onClick={() => remove(t.meta.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="lightbox-back" onClick={() => setLightbox(null)}>
          <img
            src={lightbox.url}
            alt={lightbox.name}
            style={{ transform: `scale(${lightbox.zoom})` }}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="lightbox-controls" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setLightbox((l) => (l ? { ...l, zoom: Math.max(0.5, l.zoom - 0.25) } : l))}>
              缩小 －
            </button>
            <button type="button" onClick={() => setLightbox((l) => (l ? { ...l, zoom: 1 } : l))}>
              复位（{Math.round(lightbox.zoom * 100)}%）
            </button>
            <button type="button" onClick={() => setLightbox((l) => (l ? { ...l, zoom: Math.min(5, l.zoom + 0.25) } : l))}>
              放大 ＋
            </button>
            <button type="button" className="primary" onClick={() => setLightbox(null)}>
              关闭（Esc）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Viz gallery entry (dev only): /src/components/viz/__gallery__/gallery.html?only=<id>&motion=reduce */
import '@/styles/index.css';
import './gallery.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VizGallery } from './VizGallery';

const q = new URLSearchParams(location.search);
if (q.get('motion')) document.documentElement.setAttribute('data-motion', q.get('motion')!);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VizGallery only={q.get('only')} />
  </StrictMode>,
);

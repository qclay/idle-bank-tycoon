// Метрика изометрических текстур. Файл собирается tools/textures.mjs —
// править руками бессмысленно, перезапустите npm run textures.

export const ISO = {
  "floor": {
    "file": "floor.png",
    "w": 1024,
    "h": 518,
    "tiles": 8,
    "anchor": [
      0.5,
      0
    ],
    "note": "ромб 8×8, сажается верхней вершиной в угол участка",
    "leftBase": 0.5,
    "rightBase": 0.5,
    "topX": 0.499,
    "topY": 0
  },
  "wall-front": {
    "file": "wall-front.png",
    "w": 1024,
    "h": 1094,
    "tiles": 8,
    "anchor": [
      0,
      0
    ],
    "note": "панель вдоль оси x, левый верхний угол — начало стены",
    "leftBase": 0.543,
    "rightBase": 0.9835,
    "topX": 0.0293,
    "topY": 0.0009
  },
  "wall-side": {
    "file": "wall-side.png",
    "w": 1024,
    "h": 1094,
    "tiles": 8,
    "anchor": [
      1,
      0
    ],
    "note": "панель вдоль оси y, правый верхний угол — начало стены",
    "leftBase": 0.9835,
    "rightBase": 0.543,
    "topX": 0.9707,
    "topY": 0.0009
  },
  "counter": {
    "file": "counter.png",
    "w": 768,
    "h": 584,
    "tiles": 2,
    "anchor": [
      0.5,
      1
    ],
    "note": "стойка 2×1, сажается низом за середину",
    "leftBase": 0.2911,
    "rightBase": 0.6284,
    "topX": 0.138,
    "topY": 0.0017
  }
};

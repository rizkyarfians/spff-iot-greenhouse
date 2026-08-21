import cors from 'cors';

import express from 'express';

import {
  apiRouter,
} from './routes/index.js';

import {
  delay,
  errorHandler,
  logger,
  notFound,
} from './middleware/common.js';


export const app =
  express();


const allowed =
  (
    process.env.CORS_ORIGIN
    ?? 'http://localhost:5173'
  )
    .split(',')
    .map(
      (
        origin,
      ) =>
        origin.trim(),
    )
    .filter(Boolean);


app.disable(
  'x-powered-by',
);


app.set(
  'trust proxy',

  process.env.TRUST_PROXY
  === 'true'

    ? 1

    : false,
);


app.use(
  cors({
    credentials:
      true,

    origin:
      (
        origin,
        callback,
      ) =>

        callback(
          null,

          !origin
          || allowed.includes(
            origin,
          ),
        ),
  }),
);


app.use(
  express.json({
    limit:
      '100kb',
  }),
);


app.use(
  logger,
);


app.use(
  '/api',
  delay,
  apiRouter,
);


app.use(
  notFound,
);


app.use(
  errorHandler,
);
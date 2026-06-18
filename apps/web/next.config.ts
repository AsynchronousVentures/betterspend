import type { NextConfig } from 'next';
import path from 'path';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  transpilePackages: ['@betterspend/shared'],
};

export default config;

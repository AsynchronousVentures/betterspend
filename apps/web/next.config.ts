import type { NextConfig } from 'next';
import path from 'path';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  transpilePackages: ['@betterspend/shared'],
  async redirects() {
    return [
      {
        source: '/supplier-scorecard',
        destination: '/vendors?view=performance',
        permanent: false,
      },
      {
        source: '/supplier-diversity',
        destination: '/vendors?view=diversity',
        permanent: false,
      },
      {
        source: '/risk-screening',
        destination: '/vendors?view=risk',
        permanent: false,
      },
      {
        source: '/vendors/onboarding',
        destination: '/vendors?view=onboarding',
        permanent: false,
      },
      {
        source: '/software-licenses',
        destination: '/contracts?view=software',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/vendors',
        has: [{ type: 'query', key: 'view', value: 'onboarding' }],
        destination: '/vendors/onboarding',
      },
      {
        source: '/vendors',
        has: [{ type: 'query', key: 'view', value: 'risk' }],
        destination: '/risk-screening',
      },
      {
        source: '/vendors',
        has: [{ type: 'query', key: 'view', value: 'performance' }],
        destination: '/supplier-scorecard',
      },
      {
        source: '/vendors',
        has: [{ type: 'query', key: 'view', value: 'diversity' }],
        destination: '/supplier-diversity',
      },
      {
        source: '/contracts',
        has: [{ type: 'query', key: 'view', value: 'software' }],
        destination: '/software-licenses',
      },
    ];
  },
};

export default config;

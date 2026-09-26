// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ShareView } from '@/components/share/ShareView';

afterEach(cleanup);

const base = {
  route: 'my-set',
  type: 'file' as const,
  content: '',
  createdAt: new Date('2026-09-26T08:00:00Z').toISOString(),
  expiresAt: new Date('2026-09-27T08:00:00Z').toISOString(),
};

describe('ShareView — file shares', () => {
  it('lists every file with its own download link plus a ZIP', () => {
    render(
      <ShareView
        {...base}
        files={[
          {
            id: 'f1',
            fileName: 'alpha.txt',
            fileSize: 1024,
            mimeType: 'text/plain',
          },
          {
            id: 'f2',
            fileName: 'beta.png',
            fileSize: 2048,
            mimeType: 'image/png',
          },
        ]}
      />,
    );

    const links = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(links).toContain('/my-set/download/f1');
    expect(links).toContain('/my-set/download/f2');
    expect(links).toContain('/my-set/download');
    expect(screen.getByText('Download all (.zip)')).toBeTruthy();
    expect(screen.getByText(/2 files · 3\.0 KB/)).toBeTruthy();
    expect(screen.getByText('alpha.txt')).toBeTruthy();
    expect(screen.getByText('beta.png')).toBeTruthy();
  });

  it('keeps the single-file shape (and old link) for one file', () => {
    render(
      <ShareView
        {...base}
        files={[
          {
            id: 'only',
            fileName: 'solo.txt',
            fileSize: 512,
            mimeType: 'text/plain',
          },
        ]}
      />,
    );

    const links = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(links).toEqual(['/my-set/download']);
    expect(screen.queryByText('Download all (.zip)')).toBeNull();
    expect(screen.queryByText('/my-set/download/only')).toBeNull();
    expect(screen.getByText('solo.txt')).toBeTruthy();
  });

  it('renders no file block when a file share has no files', () => {
    render(<ShareView {...base} files={[]} />);
    expect(screen.queryByText('Download all (.zip)')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('still shows the code viewer for code shares', () => {
    render(<ShareView {...base} type="code" content="const a = 1;" />);
    expect(screen.queryByText('Download all (.zip)')).toBeNull();
  });
});

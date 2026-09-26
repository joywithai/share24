// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShareView } from '@/components/share/ShareView';

afterEach(cleanup);

const twoFiles = [
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
];

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

describe('ShareView — download tokens and the resume-after-PIN flow', () => {
  it('signs every download link, so it works without the unlock cookie', () => {
    render(
      <ShareView
        {...base}
        files={twoFiles}
        downloadTokens={{ all: 'tok-all', f1: 'tok-1', f2: 'tok-2' }}
      />,
    );

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/my-set/download?k=tok-all');
    expect(hrefs).toContain('/my-set/download/f1?k=tok-1');
    expect(hrefs).toContain('/my-set/download/f2?k=tok-2');
  });

  it('leaves links unsigned when the page is a code share', () => {
    render(<ShareView {...base} type="code" content="x" downloadTokens={{}} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('resumes a download that bounced off the PIN gate', async () => {
    const clicked: string[] = [];
    const spy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.getAttribute('data-download-key') ?? '');
      });

    try {
      render(
        <ShareView
          {...base}
          files={twoFiles}
          downloadTokens={{ all: 'tok-all' }}
          downloadIntent="all"
        />,
      );

      await waitFor(() => expect(clicked).toEqual(['all']));
    } finally {
      spy.mockRestore();
    }
  });

  it('resumes one specific file, and does nothing for an unknown intent', async () => {
    const clicked: string[] = [];
    const spy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.getAttribute('data-download-key') ?? '');
      });

    try {
      const { unmount } = render(
        <ShareView {...base} files={twoFiles} downloadIntent="f2" />,
      );
      await waitFor(() => expect(clicked).toEqual(['f2']));
      unmount();

      render(<ShareView {...base} files={twoFiles} downloadIntent="gone" />);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(clicked).toEqual(['f2']);
    } finally {
      spy.mockRestore();
    }
  });
});

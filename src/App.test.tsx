import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { useStore } from './store/useStore';

describe('App', () => {
  it('renders the workspace with the example notebook and navigation panels', async () => {
    render(<App />);
    expect(await screen.findByLabelText('Navigazione')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Benvenuto in GlassNotes').length).toBeGreaterThan(0));
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
    expect(screen.getByTestId('tool-palette')).toBeInTheDocument();
  });

  it('switches tools from the palette', async () => {
    render(<App />);
    const pen = await screen.findAllByRole('button', { name: 'Penna' });
    fireEvent.click(pen[0]);
    expect(useStore.getState().tool).toBe('pen');
  });

  it('opens the shortcut reference from the toolbar', async () => {
    render(<App />);
    const btn = await screen.findAllByRole('button', { name: 'Scorciatoie da tastiera' });
    fireEvent.click(btn[0]);
    expect(await screen.findByTestId('shortcuts-overlay')).toBeInTheDocument();
    expect(screen.getAllByText('Nuova pagina').length).toBeGreaterThan(0);
  });
});

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { it, expect, vi } from 'vitest';
import TopBar from './TopBar';
vi.mock('../hooks/useExplorationMode', () => ({ EXPLORATION_MODES: { RANDOM: 'random', CUSTOM: 'custom' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({t: k=>k, i18n:{language:'zh',resolvedLanguage:'zh'}}) }));

it('closes the dialog with Escape from a button and traps tab navigation', () => {
  const change = vi.fn();
  render(<MemoryRouter><TopBar explorationMode="random" onPreferenceChange={change} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:/custom_mode/}));
  const input=screen.getByRole('textbox');
  fireEvent.change(input,{target:{value:'   '}});
  expect(screen.getByRole('button',{name:'save_and_explore'})).toBeDisabled();
  fireEvent.change(input,{target:{value:'volcanoes'}});
  const save=screen.getByRole('button',{name:'save_and_explore'});
  save.focus(); fireEvent.keyDown(save,{key:'Tab'});
  expect(input).toHaveFocus();
  screen.getByRole('button',{name:'cancel'}).focus();
  fireEvent.keyDown(document.activeElement,{key:'Escape'});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:/custom_mode/})).toHaveFocus();
  expect(change).not.toHaveBeenCalled();
});

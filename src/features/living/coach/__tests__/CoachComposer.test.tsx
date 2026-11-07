import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderLiving } from '../../testing';
import { CoachComposer, type CoachComposerProps } from '../../components/CoachComposer';

function show(props: Partial<CoachComposerProps> = {}) {
  const onSend = vi.fn();
  renderLiving(<CoachComposer variant="full" onSend={onSend} {...props} />);
  return { onSend, field: screen.getByRole('textbox', { name: 'Message to the Coach' }) };
}

describe('CoachComposer', () => {
  it('Enter sends, Shift+Enter starts a new line, and the field clears after sending', async () => {
    const user = userEvent.setup();
    const { onSend, field } = show();
    expect(field).toHaveAttribute('placeholder', 'Tell the Coach or ask…');
    await user.type(field, 'had dal{Shift>}{Enter}{/Shift}and rice');
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('had dal\nand rice');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith({ text: 'had dal\nand rice' });
    expect(field).toHaveValue('');
  });

  it('does not send an empty message', async () => {
    const user = userEvent.setup();
    const { onSend, field } = show();
    await user.type(field, '   {Enter}');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows at most three prompt chips; a chip sends its text unless onChip is given', async () => {
    const user = userEvent.setup();
    const onChip = vi.fn();
    const { onSend } = show({
      chips: ['log lunch as planned', 'why is my weight up?', 'I’m busy Thursday to Saturday', 'a fourth'],
    });
    expect(screen.getAllByRole('button', { name: /lunch|weight|busy|fourth/ })).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'why is my weight up?' }));
    expect(onSend).toHaveBeenCalledWith({ text: 'why is my weight up?' });
    renderLiving(
      <CoachComposer variant="full" onSend={vi.fn()} chips={['help me choose a plan']} onChip={onChip} />,
    );
    await user.click(screen.getByRole('button', { name: 'help me choose a plan' }));
    expect(onChip).toHaveBeenCalledWith('help me choose a plan');
  });

  it('while busy the send key becomes a keyboard-reachable Stop', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const { onSend, field } = show({ busy: true, onStop });
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.type(field, 'more{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Stop the Coach' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('the photo key opens the camera or library, or picks a PDF', async () => {
    const user = userEvent.setup();
    const { onSend } = show();
    expect(screen.getByRole('button', { name: 'Add a photo or PDF' })).toBeInTheDocument();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).toHaveAttribute('accept', 'image/*,application/pdf');
    const photo = new File(['x'], 'meal.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [photo] } });
    expect(screen.getByText('Photo attached')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith({ text: '', photo });
  });

  it('without vision there is no photo key, and a pasted image explains why', () => {
    const { field } = show({ vision: false });
    expect(screen.queryByRole('button', { name: 'Add a photo or PDF' })).not.toBeInTheDocument();
    const photo = new File(['x'], 'meal.png', { type: 'image/png' });
    fireEvent.paste(field, { clipboardData: { files: [photo] } });
    expect(screen.getByRole('status')).toHaveTextContent(
      'This model can’t see photos. Describe the meal in words, or choose a model with vision in Settings.',
    );
  });

  it('without vision a PDF report can still be picked and sent (it is read on this device) (Q4-14)', async () => {
    const user = userEvent.setup();
    const { onSend } = show({ vision: false });
    expect(screen.getByRole('button', { name: 'Add a PDF report' })).toBeInTheDocument();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).toHaveAttribute('accept', 'application/pdf');
    const pdf = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(screen.getByText('PDF attached · report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove the PDF' })).toBeInTheDocument();
    // a picked image still explains that this model can't see photos
    fireEvent.change(input, { target: { files: [new File(['x'], 'meal.png', { type: 'image/png' })] } });
    expect(screen.getByRole('status')).toHaveTextContent('This model can’t see photos.');
    expect(screen.getByText('PDF attached · report.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith({ text: '', photo: pdf });
  });

  it('disabled is honest: the field and the send key are disabled, with no chips and no attach key', async () => {
    const user = userEvent.setup();
    const { onSend, field } = show({
      disabled: true,
      chips: ['why is my weight up?'],
      defaultText: 'had oats',
    });
    expect(field).toBeDisabled();
    // a handed-over draft stays visible
    expect(field).toHaveValue('had oats');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add a photo or PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Suggestions' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('the send key is the gold primary; prompt chips are neutral pills', () => {
    show({ chips: ['why is my weight up?'] });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByRole('button', { name: 'why is my weight up?' })).toHaveClass('lm-chip');
  });

  it('hides suggestions while the person has a draft and restores them when it is cleared', async () => {
    const user = userEvent.setup();
    const { field } = show({ chips: ['why is my weight up?'] });
    expect(screen.getByRole('group', { name: 'Suggestions' })).toBeInTheDocument();
    await user.type(field, 'my question');
    expect(screen.queryByRole('group', { name: 'Suggestions' })).not.toBeInTheDocument();
    await user.clear(field);
    expect(screen.getByRole('group', { name: 'Suggestions' })).toBeInTheDocument();
  });

  it('bar: one line with photo and send', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderLiving(<CoachComposer variant="bar" onSend={onSend} chips={['ignored in the bar']} />);
    const input = screen.getByRole('textbox', { name: 'Message to the Coach' });
    expect(input.tagName).toBe('INPUT');
    expect(screen.queryByRole('button', { name: 'ignored in the bar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a photo or PDF' })).toBeInTheDocument();
    await user.type(input, 'walked 40 min{Enter}');
    expect(onSend).toHaveBeenCalledWith({ text: 'walked 40 min' });
  });
});

import { CardHead, GradientCard, type GradientCardProps, type InfoSpec } from '@/components';
import type { IconComponent } from '@/components/icons/Icon';

/** Progress's card frame. The foundation owns the information panel and its T shortcut. */
export function ProgressCard({
  title,
  icon,
  info,
  className,
  ...props
}: Omit<GradientCardProps, 'head'> & { title: string; icon: IconComponent; info: InfoSpec }) {
  return (
    <GradientCard
      as="section"
      {...props}
      className={['lv-prog-face', className].filter(Boolean).join(' ')}
      head={<CardHead as="h2" title={title} icon={icon} info={info} />}
    />
  );
}

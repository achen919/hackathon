interface AvatarProps {
  name: string;
  tone: 'coral' | 'violet';
  size?: 'small' | 'medium' | 'large';
}

export function Avatar({ name, tone, size = 'medium' }: AvatarProps) {
  const initials = Array.from(name).slice(-2).join('');

  return (
    <span className={`avatar avatar--${tone} avatar--${size}`} aria-label={`${name}的头像`}>
      {initials}
    </span>
  );
}

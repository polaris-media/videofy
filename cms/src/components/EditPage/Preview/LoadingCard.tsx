import type { FC } from 'react';

const LoadingCard: FC = () => (
  <div className="flex h-96 w-full items-center rounded-lg border-2 border-gray-300 border-dashed p-12 dark:border-gray-700">
    <span className="mt-2 block w-full text-center font-semibold text-gray-900 text-sm dark:text-gray-100">
      Loading preview...
    </span>
  </div>
);

export default LoadingCard;

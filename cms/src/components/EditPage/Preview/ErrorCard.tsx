import type { FC } from 'react';

interface Props {
  errorMessage: string;
}

const ErrorCard: FC<Props> = ({ errorMessage }) => (
  <div className="flex h-96 w-full flex-col items-center justify-center rounded-lg border-2 border-gray-300 border-dashed p-12 dark:border-gray-700">
    <p className="mt-2 block w-full text-center font-semibold text-gray-900 text-sm dark:text-gray-100">
      Something went wrong while generating the preview.
    </p>
    <p className="mt-2 block w-full text-center font-semibold text-gray-900 text-sm dark:text-gray-100">
      {errorMessage}
    </p>
  </div>
);

export default ErrorCard;

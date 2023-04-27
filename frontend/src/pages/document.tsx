import { RouteComponentProps, useLocation } from 'wouter';
import { IoIosArrowBack } from 'react-icons/io';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../common/top_bar';
import { AppContainer } from '../components/app';
import { IconButton } from '../components/button';
import { TranscriptionEditor } from '../editor/transcription_editor';
import { WorkerStatus } from '../editor/worker_status';
import { useGetDocument } from '../api/document';

export function DocumentPage({ params }: RouteComponentProps<{ documentId: string }>) {
  const { data } = useGetDocument({ document_id: params.documentId });
  const [_location, navigate] = useLocation();

  return (
    <AppContainer>
      <TopBar>
        <TopBarPart className="sticky left-4 -ml-12">
          <IconButton
            icon={IoIosArrowBack}
            label="back to document gallery"
            onClick={() => navigate('/')}
          />
          <TopBarTitle>{data?.name}</TopBarTitle>
        </TopBarPart>

        <TopBarPart>
          <WorkerStatus documentId={params.documentId} />
          <MeButton />
        </TopBarPart>
      </TopBar>

      <TranscriptionEditor documentId={params.documentId} />
    </AppContainer>
  );
}

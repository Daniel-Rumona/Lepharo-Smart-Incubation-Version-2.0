import React from 'react'
import { Button, Card, Result } from 'antd'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'

const ParticipantSuccess: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div style={{ padding: 24 }}>
      <Helmet>
        <title>Participant Onboarded | Incubation Platform</title>
      </Helmet>

      <Card>
        <Result
          status='success'
          title='Participant Successfully Added!'
          subTitle='You have successfully onboarded a new participant into the platform.'
          extra={[
            <Button
              type='primary'
              key='view'
              onClick={() => navigate('/consultant/participants')}
            >
              View All Participants
            </Button>,
            <Button
              key='new'
              onClick={() => navigate('/consultant/participants/new')}
            >
              Add Another Participant
            </Button>
          ]}
        />
      </Card>
    </div>
  )
}

export default ParticipantSuccess

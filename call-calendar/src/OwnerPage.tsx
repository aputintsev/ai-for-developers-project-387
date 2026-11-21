import MeetingTypeList from './MeetingTypeList'
import OwnerBookingList from './OwnerBookingList'

function OwnerPage() {
  return (
    <div className="mt-8 grid gap-5">
      <OwnerBookingList />
      <MeetingTypeList allowCreation />
    </div>
  )
}

export default OwnerPage
